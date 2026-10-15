import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSpe,averageFrames,subtract,binRows} from '../spe.js';
function fixture(type=3,width=1024,height=2,count=2){
 const bytes=[0,1,8].includes(type)?4:2;
 const buf=new ArrayBuffer(4100+width*height*count*bytes),v=new DataView(buf);
 v.setUint16(42,width,true);v.setUint16(656,height,true);v.setInt32(1446,count,true);v.setInt16(108,type,true);v.setFloat32(1992,2.5,true);
 return {buf,v};
}
test('SPE float keeps signed values and fractional precision; frames average',()=>{
 const {buf,v}=fixture(0);v.setFloat32(4100,-3.25,true);v.setFloat32(4100+1024*2*4,100003.5,true);
 const spe=parseSpe(buf);assert.equal(spe.frames[0][0],-3.25);assert.equal(spe.frames[1][0],100003.5);assert.equal(averageFrames(spe,[0,1])[0],50000.125);
});
test('signed/unsigned 16-bit, signed/unsigned 32-bit decode',()=>{
 for(const [type,set,value] of [[1,'setInt32',-123456],[2,'setInt16',-200],[3,'setUint16',65535],[8,'setUint32',4000000000]]){const {buf,v}=fixture(type);v[set](4100,value,true);assert.equal(parseSpe(buf).frames[0][0],value);}
});
test('truncated, unsupported, wrong-width and SPE3 inputs fail explicitly',()=>{
 assert.throws(()=>parseSpe(new ArrayBuffer(20)),/header/);
 const {buf,v}=fixture();assert.throws(()=>parseSpe(buf.slice(0,-1)),/Truncated/);
 v.setInt16(108,7,true);assert.throws(()=>parseSpe(buf),/type/);v.setInt16(108,3,true);
 v.setUint16(42,512,true);assert.throws(()=>parseSpe(buf),/1024/);v.setUint16(42,1024,true);
 v.setFloat32(1992,3,true);assert.throws(()=>parseSpe(buf),/3.x/);
});
test('background subtraction preserves negatives and validates size',()=>{
 const a={width:2,height:1,data:new Float64Array([2,9])},b={width:2,height:1,data:new Float64Array([3,1])};assert.deepEqual([...subtract(a,b)],[-1,8]);assert.throws(()=>subtract(a,{...b,height:2}),/dimensions/);
});
test('Y bins average contiguous rows including last partial bin, with unchanged X',()=>{
 const rows=binRows(new Float64Array([1,2,3,4,5,6,7,8,9,10]),2,5,1,5,3);
 assert.deepEqual(rows,[[5,6],[9,10]]);
 for(const args of [[-1,2,1],[0,6,1],[0,2,0],[0,2,.5],[2,2,1]])assert.throws(()=>binRows([],2,5,...args),/Y/);
 assert.throws(()=>averageFrames({width:2,height:1,frames:[]},[]),/frame/);
});

test('four-file Rayleigh zeros negative pair differences before averaging', async()=>{
 const {averageRayleigh}=await import('../spe.js');
 const image=values=>({width:2,height:1,data:new Float64Array(values)});
 const first=image([10,4]), second=image([2,10]), third=image([26,4]), fourth=image([6,0]);
 assert.deepEqual([...averageRayleigh(first,second,third,fourth)],[14,2]);
 assert.deepEqual([...averageRayleigh(second,first,fourth,third)],[0,3]);
 assert.deepEqual([...first.data],[10,4]);
 assert.throws(()=>averageRayleigh(first,second,{...third,height:2},{...fourth,height:2}),/four/);
 assert.throws(()=>averageRayleigh(first,second,third,{...fourth,height:2}),/dimensions/);
});

test('Rayleigh pair comparison uses clipped totals and symmetric percentage', async()=>{
 const {rayleighPairComparison}=await import('../spe.js');
 const image=values=>({width:values.length,height:1,data:new Float64Array(values)});
 const a=image([10,4]), b=image([2,10]), c=image([26,4]), d=image([6,0]);
 const result=rayleighPairComparison(a,b,c,d);
 assert.equal(result.firstTotal,8);assert.equal(result.secondTotal,24);
 assert.equal(result.differencePercent,100);
 assert.equal(rayleighPairComparison(c,d,a,b).differencePercent,100);
 assert.equal(rayleighPairComparison(a,b,a,b).differencePercent,0);
 assert.equal(rayleighPairComparison(b,a,d,c).differencePercent,200);
 assert.equal(rayleighPairComparison(a,a,c,c).differencePercent,null);
 assert.deepEqual([...a.data],[10,4]);
 assert.throws(()=>rayleighPairComparison(a,b,{...c,height:2},{...d,height:2}),/four/);
 assert.throws(()=>rayleighPairComparison(a,b,c,{...d,height:2}),/dimensions/);
});

test('Rayleigh range comparison uses every pixel within exclusive Y bounds', async()=>{
 const {rayleighPairComparison}=await import('../spe.js');
 const image=values=>({width:2,height:3,data:Float64Array.from(values)});
 const a=image([10,-2,20,20,0,0]),b=image([0,0,0,0,0,0]),c=image([5,0,20,20,0,0]);
 assert.equal(rayleighPairComparison(a,b,c,b,{from:0,to:1}).differencePercent,5/7.5*100);
 assert.equal(rayleighPairComparison(a,b,c,b,{from:1,to:2}).differencePercent,0);
 assert.equal(rayleighPairComparison(a,b,c,b,{from:2,to:3}).differencePercent,null);
 const range=rayleighPairComparison(a,b,c,b,{from:1,to:3});assert.equal(range.firstTotal,40);
 assert.deepEqual(rayleighPairComparison(a,b,c,b,{from:0,to:3}),rayleighPairComparison(a,b,c,b));
 for(const [from,to] of [[-1,2],[0,4],[1,1],[2,1],[.5,2],[0,NaN]])assert.throws(()=>rayleighPairComparison(a,b,c,b,{from,to}),/Comparison Y range/);
});
