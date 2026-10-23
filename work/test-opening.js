const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const base = 'outputs/Webengine-Hacks/';
const manifest = JSON.parse(fs.readFileSync(base+'manifest.json'));
assert.equal(manifest.action.default_popup, 'popup.html');
assert(!manifest.background, 'Only one launch path should be active');
const nodes = new Map();
const node = () => ({value:'',textContent:'',disabled:false,className:'',addEventListener(){},replaceChildren(){},append(){},focus(){},closest(){return {after(){}}}});
const calls = [];
const context = {
  document: {querySelector(s){if(!nodes.has(s))nodes.set(s,node());return nodes.get(s)},createElement:node},
  chrome: {
    tabs: {
      query:async()=>[{id:1,url:'https://test.example'}],
      sendMessage:async(id,msg,options)=>{
        calls.push(options.frameId);
        return {ok:true,data:{memories:options.frameId===8?[{id:1,label:'game',bytes:65536}]:[]}};
      }
    },
    webNavigation:{getAllFrames:async()=>[{frameId:0},{frameId:8}]}
  },
  window:{close(){}},console
};
vm.runInNewContext(fs.readFileSync(base+'popup.js','utf8'),context);
setImmediate(()=>{
  assert.equal(vm.runInNewContext('activeFrameId',context),8);
  assert.equal(nodes.get('#scan').disabled,false);
  assert.deepEqual(calls,[0,8]);
  console.log('Opening regression passed: popup configured, game frame selected, scan enabled.');
});
