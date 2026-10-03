import test from 'node:test';
import assert from 'node:assert/strict';
import {frameDimension,cspSafeFrame} from '../src/arwes-frame-math.ts';
import {createFrameOctagonSettings,createFrameCornersSettings} from '@arwes/frames';
test('frame dimensions resolve mixed percent and pixel offsets without evaluating code',()=>{
 assert.equal(frameDimension(240,'100% - 12'),228);
 assert.equal(frameDimension(80,'50% + 4 - 2.5'),41.5);
 assert.equal(frameDimension(80,12),12);
 for(const value of ['alert(1)','10*20','NaN','']) assert.throws(()=>frameDimension(100,value));
});
test('Arwes presets render only numeric paths and adapt to different window sizes',()=>{
 for(const preset of [createFrameOctagonSettings({squareSize:12}),createFrameCornersSettings({cornerLength:28})]){
  const safe=cspSafeFrame(preset);let count=0, resized=0;
  const visit=element=>{
   if(element.elements)element.elements.forEach(visit);
   if(element.path){assert.equal(typeof element.path,'function');
    const small=element.path({width:320,height:180});const large=element.path({width:640,height:360});
    assert.doesNotMatch(small,/%|NaN|undefined/);assert.doesNotMatch(large,/%|NaN|undefined/);
    assert.match(small,/^[MmLlHhVvZz\d\s.,+-]+$/);if(small!==large)resized++;count++;
   }
  };safe.elements.forEach(visit);assert.ok(count>0);assert.ok(resized>0);
 }
});

