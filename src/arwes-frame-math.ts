import type {FrameSettings,FrameSettingsElement,FrameSettingsPathDefinition} from '@arwes/frames';

// Arwes' supplied octagon/corner presets need only additive pixel/percent terms.
// Resolve these directly so native and callback CSP never need unsafe-eval.
export function frameDimension(size:number,value:string|number):number{
 if(typeof value==='number')return value;
 const expression=value.replace(/\s/g,'');
 if(!/^[+-]?\d*\.?\d+%?(?:[+-]\d*\.?\d+%?)*$/.test(expression))throw new Error('Unsupported Arwes frame dimension');
 return(expression.match(/[+-]?\d*\.?\d+%?/g)||[]).reduce((sum,term)=>sum+(term.endsWith('%')?parseFloat(term)*size/100:Number(term)),0);
}
function pathText(path:FrameSettingsPathDefinition,width:number,height:number){
 return path.map(command=>{
  if(typeof command==='string')return command;
  const[name,...values]=command;
  return name+' '+values.map((value,index)=>frameDimension(name.toLowerCase()==='h'?width:name.toLowerCase()==='v'?height:index%2===0?width:height,value)).join(',');
 }).join(' ');
}
export function cspSafeFrame(settings:FrameSettings):FrameSettings{
 const convert=(element:FrameSettingsElement):FrameSettingsElement=>{
  if(element.type==='rect'){
   const{x,y,width:w,height:h}=element;
   return{type:'path',name:element.name,style:element.style,path:({width,height})=>{
    const left=frameDimension(width,x),top=frameDimension(height,y),right=left+frameDimension(width,w),bottom=top+frameDimension(height,h);
    return`M ${left},${top} H ${right} V ${bottom} H ${left} Z`;
   }};
  }
  if('path'in element&&Array.isArray(element.path)){const path=element.path;return{...element,path:({width,height})=>pathText(path,width,height)}}
  if('elements'in element&&Array.isArray(element.elements))return{...element,elements:element.elements.map(convert)};
  return element;
 };
 return{...settings,elements:settings.elements.map(convert)};
}
