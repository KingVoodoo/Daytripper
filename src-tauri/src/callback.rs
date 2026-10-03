use base64::{engine::general_purpose::STANDARD,Engine};
use crate::auth::Character;
fn data(bytes:&[u8])->String{format!("data:image/png;base64,{}",STANDARD.encode(bytes))}
fn escape(text:&str)->String{text.replace('&',"&amp;").replace('<',"&lt;").replace('>',"&gt;").replace('"',"&quot;").replace('\'',"&#39;")}
pub fn page(result:&Result<Character,String>,cutout:Option<&[u8]>)->String{
 let art:[&[u8];8]=[
 include_bytes!("../../public/splash/01-amarr.png"),include_bytes!("../../public/splash/02-caldari.png"),include_bytes!("../../public/splash/03-gallente.png"),include_bytes!("../../public/splash/04-minmatar.png"),include_bytes!("../../public/splash/05-guristas.png"),include_bytes!("../../public/splash/06-angel.png"),include_bytes!("../../public/splash/07-sansha.png"),include_bytes!("../../public/splash/08-triglavian.png")];
 let mut slides:serde_json::Value=serde_json::from_str(include_str!("../../src/splash-slides.json")).expect("bundled splash slides");
 for (i,slide) in slides.as_array_mut().unwrap().iter_mut().enumerate(){slide["image"]=data(art[i]).into()}
 let (title,message,portrait)=match result{
  Ok(character)=>{
   let portrait=cutout.map(|png|format!("<img class=\"splash-portrait\" src=\"{}\" alt=\"Character portrait\">",data(png))).unwrap_or_else(||"<p class=\"splash-portrait-note\">Portrait unavailable. You can still continue in Daytripper.</p>".into());
   (format!("Welcome aboard,<br>{}.",escape(&character.name)),"Your EVE character is linked. Pilot tracking is ready in Daytripper.".to_string(),portrait)
  },
  Err(_)=>("Sign-in did not complete.".into(),"Your character was not linked. Return to Daytripper for the error details and try signing in again.".into(),String::new())
 };
 include_str!("callback.html").replace("{{CSS}}",&format!("{}\n{}\n{}",include_str!("callback-fonts.css"),include_str!("../../src/splash.css"),include_str!("../../src/main-scifi.css"))).replace("{{ARWES}}",include_str!("arwes-callback.js")).replace("{{LOGO}}",&data(include_bytes!("../../public/brand/daytripper.png"))).replace("{{SLIDES}}",&slides.to_string().replace('<',"\\u003c")).replace("{{PORTRAIT}}",&portrait).replace("{{MESSAGE}}",&message).replace("{{TITLE}}",&title)
}
pub async fn reply(app:&tauri::AppHandle,stream:&mut tokio::net::TcpStream,result:&Result<Character,String>){
 use tokio::io::AsyncWriteExt;
 let body=page(result,None).replace("Portrait unavailable. You can still continue in Daytripper.","Preparing your portrait…");
 // Connection-delimited streaming displays the tips before local inference finishes.
 let header="HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'\r\nConnection: close\r\n\r\n";
 let sent=tokio::time::timeout(std::time::Duration::from_secs(20),async{stream.write_all(header.as_bytes()).await?;stream.write_all(body.as_bytes()).await}).await;
 if !matches!(sent,Ok(Ok(()))){return}
 if let Ok(character)=result {
  let cutout=crate::portrait::prepare(app,&character.id).await;
  let script=match cutout {
   Ok(png)=>format!("<script>{{const n=document.querySelector('.splash-portrait-note'),i=document.createElement('img');i.className='splash-portrait';i.alt='Character portrait';i.src='{}';n?.replaceWith(i);}}</script>",data(&png)),
   Err(_)=>"<script>document.querySelector('.splash-portrait-note').textContent='Portrait unavailable. You can still continue in Daytripper.';</script>".into()
  };
  let _=tokio::time::timeout(std::time::Duration::from_secs(10),stream.write_all(script.as_bytes())).await;
 }
 let _=stream.shutdown().await;
}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn escapes_character_markup(){assert_eq!(escape("<script>&\"'"),"&lt;script&gt;&amp;&quot;&#39;")}
 #[test]#[ignore]fn export_design_preview(){let png=crate::portrait::strip(include_bytes!("../../public/portraits/864790310-original.jpg")).unwrap();let html=page(&Ok(Character{id:"864790310".into(),name:"King Voodoo".into()}),Some(&png)).replace("EVE SIGN-IN","DESIGN PREVIEW — NOT A LIVE SIGN-IN");std::fs::write("../art-direction/callback-preview.html",html).unwrap()}
 #[test]fn callback_has_tips_and_no_unexpanded_slots(){let html=page(&Err("sensitive internal error".into()),None);assert!(!html.contains("sensitive internal error"));assert!(!html.contains("{{"));assert!(html.contains("Sign-in did not complete"));assert!(html.contains("TIP · "));assert_eq!(html.matches("\"image\":\"data:image/png;base64,").count(),8)}
}
