import test from 'node:test';
import assert from 'node:assert/strict';
let edits={};try{edits=await import('../service/edits.js');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
test('correction boundaries are implemented',()=>assert.equal(typeof edits.locateIssue,'function','Own-text correction is not implemented'));
if(edits.locateIssue){
  test('finds article a rather than the a inside have',()=>{
    const text='I have a apple.';const issue=edits.locateIssue(text,{original:'a',replacement:'an',sentence:text,category:'articles'});
    assert.equal(issue.offset,7);assert.equal(edits.applyEdits(text,[issue]),'I have an apple.');
  });
  test('preserves Unicode, smart quotes, whitespace and untouched words',()=>{
    const text="🙂 Yesterday  I go home.\nShe don’t like tea.";
    const first=edits.locateIssue(text,{original:'go',replacement:'went',sentence:'Yesterday I go home.',category:'verb_tense'});
    const second=edits.locateIssue(text,{original:"don't",replacement:"doesn't",sentence:"She don't like tea.",category:'agreement'});
    assert.equal(edits.applyEdits(text,[first,second]),"🙂 Yesterday  I went home.\nShe doesn't like tea.");
  });
  test('anchors repeated words to their exact sentence',()=>{
    const text='I go to work. Yesterday I go to the park.';
    const issue=edits.locateIssue(text,{original:'go',replacement:'went',sentence:'Yesterday I go to the park.',category:'verb_tense'});
    assert.equal(edits.applyEdits(text,[issue]),'I go to work. Yesterday I went to the park.');
  });
  test('uses independently verified positions for repeated typos in one sentence',()=>{
    const text='I think tha it works because she says tha it works.';
    const candidate={original:'tha',replacement:'that',sentence:text,category:'spelling'};
    const offsets=[...text.matchAll(/\btha\b/g)].map(match=>match.index);
    const issues=offsets.map(offset=>edits.locateIssue(text,candidate,{offset,length:3}));
    assert.deepEqual(issues.map(issue=>issue?.offset),offsets);
    assert.equal(edits.applyEdits(text,issues),'I think that it works because she says that it works.');
    assert.equal(edits.locateIssue(text,candidate,{offset:0,length:3}),null);
    assert.equal(edits.locateIssue(text,candidate),null);
  });
  test('a unique exact fragment remains usable when the model quotes the corrected sentence',()=>{
    const text="She don't like coffee.";
    const issue=edits.locateIssue(text,{original:"don't",replacement:"doesn't",sentence:"She doesn't like coffee.",category:'agreement'});
    assert.equal(edits.applyEdits(text,[issue]),"She doesn't like coffee.");
  });
  test('rejects invented spans and overlapping edits',()=>{
    assert.equal(edits.locateIssue('I like coffee.',{original:'tea',replacement:'coffee',sentence:'I like tea.',category:'other'}),null);
    assert.throws(()=>edits.applyEdits('I go.',[{offset:2,length:2,original:'go',replacement:'went'},{offset:2,length:2,original:'go',replacement:'goes'}]));
  });
  test('rejects optional wording, contraction preferences and verbose rewrites',()=>{
    assert.equal(edits.isAllowedEdit({original:'happy',replacement:'delighted',category:'style'}),false);
    assert.equal(edits.isAllowedEdit({original:"I don't like tea",replacement:'I do not like tea',category:'other'}),false);
    assert.equal(edits.isAllowedEdit({original:'good',replacement:'exceptionally impressive and highly commendable',category:'other'}),false);
    assert.equal(edits.isAllowedEdit({original:'go',replacement:'went',category:'verb_tense'}),true);
  });
}
