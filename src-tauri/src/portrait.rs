//! Local portrait segmentation. The model ships in the binary; no inference API.
use std::{io::Cursor,path::Path,sync::OnceLock};
use image::{DynamicImage,GrayImage,ImageFormat,imageops::FilterType};
use sha2::{Digest,Sha256};
use tauri::Manager;
use tract_onnx::prelude::*;

type Model=SimplePlan<TypedFact,Box<dyn TypedOp>,TypedModel>;
static MODEL:OnceLock<Result<Model,String>>=OnceLock::new();
fn model()->Result<&'static Model,String>{
 MODEL.get_or_init(||{
  let loader=tract_onnx::onnx();
  let mut proto=loader.proto_model_for_read(&mut Cursor::new(include_bytes!("../models/u2netp.onnx"))).map_err(|e|format!("{e:#}"))?;
  // This fixed 320px U2Net model only upsamples spatial dimensions > 1.
  // ONNX half_pixel and pytorch_half_pixel are equivalent for those resizes.
  for node in &mut proto.graph.as_mut().ok_or("Missing model graph")?.node {
   if node.op_type=="Resize" {for attr in &mut node.attribute {
    if attr.name=="coordinate_transformation_mode"&&attr.s==b"pytorch_half_pixel"{attr.s=b"half_pixel".to_vec()}
   }}
  }
  // Materialize fixed resize scales: tract 0.21 reads an empty scales input
  // instead of the sizes input at execution time. The fixed input dimensions
  // let us compute equivalent scales without changing the learned model.
  let typed=loader.model_for_proto_model(&proto).and_then(|m|m.with_input_fact(0,f32::fact([1,3,320,320]).into())).and_then(|m|m.into_typed()).map_err(|e|format!("{e:#}"))?;
  let pg=proto.graph.as_mut().unwrap();
  for node in &mut pg.node {if node.op_type=="Resize" {
   let tn=typed.node_by_name(&node.name).map_err(|e|format!("{e:#}"))?;
   let input=typed.outlet_fact(tn.inputs[0]).map_err(|e|format!("{e:#}"))?.shape.as_concrete().ok_or("Dynamic resize input")?;
   let output=tn.outputs[0].fact.shape.as_concrete().ok_or("Dynamic resize output")?;
   let name=format!("daytripper_scales_{}",node.name);
   pg.initializer.push(tract_onnx::pb::TensorProto{name:name.clone(),dims:vec![4],data_type:1,float_data:input.iter().zip(output).map(|(a,b)|*b as f32 / *a as f32).collect(),..Default::default()});
   node.input[2]=name;node.input[3]=String::new();
  }}
  let mut graph=loader.model_for_proto_model(&proto).map_err(|e|format!("{e:#}"))?;
  let output=graph.output_outlets().map_err(|e|format!("{e:#}"))?[0];
  graph.set_output_outlets(&[output]).map_err(|e|format!("{e:#}"))?;
  graph.with_input_fact(0,f32::fact([1,3,320,320]).into()).and_then(|m|m.into_optimized()).and_then(|m|m.into_runnable()).map_err(|e|format!("{e:#}"))
 }).as_ref().map_err(Clone::clone)
}

pub fn strip(bytes:&[u8])->Result<Vec<u8>,String>{
 let mut reader=image::ImageReader::new(Cursor::new(bytes)).with_guessed_format().map_err(|e|format!("{e:#}"))?;
 let mut limits=image::Limits::default();limits.max_image_width=Some(2048);limits.max_image_height=Some(2048);limits.max_alloc=Some(64*1024*1024);reader.limits(limits);
 let original=reader.decode().map_err(|e|format!("{e:#}"))?;
 let resized=image::imageops::resize(&original.to_rgb8(),320,320,FilterType::Lanczos3);
 let max=resized.as_raw().iter().copied().max().unwrap_or(1).max(1) as f32;
 let input=tract_ndarray::Array4::from_shape_fn((1,3,320,320),|(_,c,y,x)|{
  (resized[(x as u32,y as u32)][c] as f32/max-[0.485,0.456,0.406][c])/[0.229,0.224,0.225][c]
 }).into_tensor();
 let output=model()?.run(tvec!(input.into())).map_err(|e|format!("{e:#}"))?;
 let mask=output[0].to_array_view::<f32>().map_err(|e|format!("{e:#}"))?;
 if mask.len()!=320*320||mask.iter().any(|v|!v.is_finite()){return Err("Invalid portrait mask".into())}
 let min=mask.iter().copied().fold(f32::INFINITY,f32::min);
 let max=mask.iter().copied().fold(f32::NEG_INFINITY,f32::max);
 if max-min<1e-6{return Err("No portrait subject found".into())}
 let alpha=mask.iter().map(|v|(((v-min)/(max-min))*255.).round().clamp(0.,255.) as u8).collect();
 let alpha=GrayImage::from_raw(320,320,alpha).ok_or("Invalid mask size")?;
 let alpha=image::imageops::resize(&alpha,original.width(),original.height(),FilterType::Lanczos3);
 let mut rgba=original.to_rgba8();
 // Preserve original pixels and apply only the predicted transparency mask.
 for(x,y,pixel)in rgba.enumerate_pixels_mut(){pixel[3]=((pixel[3] as u16*alpha[(x,y)][0] as u16)/255) as u8;}
 let mut png=Cursor::new(Vec::new());DynamicImage::ImageRgba8(rgba).write_to(&mut png,ImageFormat::Png).map_err(|e|format!("{e:#}"))?;
 Ok(png.into_inner())
}

fn cached_strip(directory:&Path,id:u64,original:&[u8])->Result<Vec<u8>,String>{
 let hash=format!("{:x}",Sha256::digest(original));
 let path=directory.join(format!("{id}-u2netp-v1-{hash}.png"));
 if let Ok(bytes)=std::fs::read(&path){if image::load_from_memory_with_format(&bytes,ImageFormat::Png).is_ok(){return Ok(bytes)}}
 let png=strip(original)?;
 // A read-only/full cache must not prevent a successful login or cutout.
 if std::fs::create_dir_all(directory).is_ok(){let temp=path.with_extension("tmp");if std::fs::write(&temp,&png).is_ok(){let _=std::fs::rename(temp,&path);}}
 Ok(png)
}

pub async fn prepare(app:&tauri::AppHandle,id:&str)->Result<Vec<u8>,String>{
 let id=id.parse::<u64>().map_err(|_|"Invalid character ID")?;
 let directory=app.path().app_cache_dir().map_err(|e|format!("{e:#}"))?.join("portraits");
 let mut response=crate::auth::client()?.get(format!("https://images.evetech.net/characters/{id}/portrait?size=1024")).send().await.map_err(|e|format!("{e:#}"))?.error_for_status().map_err(|e|format!("{e:#}"))?;
 let mut bytes=Vec::new();while let Some(chunk)=response.chunk().await.map_err(|e|format!("{e:#}"))?{if bytes.len()+chunk.len()>4*1024*1024{return Err("Portrait is too large".into())}bytes.extend_from_slice(&chunk)}
 tauri::async_runtime::spawn_blocking(move||cached_strip(&directory,id,&bytes)).await.map_err(|e|format!("{e:#}"))?
}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn rejects_invalid_image(){assert!(strip(b"not an image").is_err())}
 #[test]fn real_portrait_keeps_pixels_and_removes_background(){
  let bytes=include_bytes!("../../public/portraits/864790310-original.jpg");let result=strip(bytes).expect("bundled model should segment EVE portrait");
  let actual=image::load_from_memory(&result).unwrap().to_rgba8();let source=image::load_from_memory(bytes).unwrap().to_rgb8();
  assert_eq!(actual.dimensions(),source.dimensions());
  for(x,y,p)in actual.enumerate_pixels(){assert_eq!(&p.0[..3],&source[(x,y)].0)}
  assert!(actual[(10,10)][3]<20,"corner background should be transparent");
  assert!(actual[(512,420)][3]>220,"face should remain opaque");
  assert!(actual.pixels().filter(|p|p[3]<20).count()>200_000);
 }
 #[test]#[ignore]fn export_automatic_cutout(){let png=strip(include_bytes!("../../public/portraits/864790310-original.jpg")).unwrap();std::fs::write("../art-direction/automatic-portrait.png",png).unwrap();}
}

