export * from './icons';
export * from './notify';
import { createLucideElement } from './icons';
export function createShellModuleIcon(name:string, className='') { return createLucideElement(name==='daytripper'?'compass':name,{size:20,className}) ?? document.createElement('span'); }
