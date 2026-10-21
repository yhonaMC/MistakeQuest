// Synthetic learner passages only. These are expected outcomes, never generated
// banks: every practice sentence still goes through the real public game API.
export const shortArcadeFixture={
 name:'short-spelling',
 sourceText:"Yesterday I go to the park with my freind. She don't like coffee. We have two dog. I think tha this book is importan.",
 correctedText:"Yesterday I went to the park with my friend. She doesn't like coffee. We have two dogs. I think that this book is important.",
 spellingPairs:[['freind','friend'],['tha','that'],['importan','important']],
 selected:[
  {original:'freind',replacement:'friend'},
  {original:'tha',replacement:'that'},
  {original:'importan',replacement:'important'}
 ]
};

export const grammarArcadeFixture={
 name:'long-grammar-word-order',
 sourceText:"Every morning, my sister walk to the library before breakfast. She don't have a car, so she usually takes the bus. Yesterday I go to the park with my freind. We was at the park for an hour. We have two dog at home. I am needing prepare a short talk for class, so I practice every day. I do not know where is my notebook. My teacher says that simple sentences are useful, and I agree with her. Today I am recording me while I tell a short story. I hope that my English improve with practice. Yesterday I read two chapter, and now I can explains the main idea. In the evening, I usually drink tea and write three short sentences about my day. I enjoy learning English, and I do not want to make my sentences more complicated. I also like reading simple stories. I think tha this lesson is importan.",
 correctedText:"Every morning, my sister walks to the library before breakfast. She doesn't have a car, so she usually takes the bus. Yesterday I went to the park with my friend. We were at the park for an hour. We have two dogs at home. I need to prepare a short talk for class, so I practice every day. I do not know where my notebook is. My teacher says that simple sentences are useful, and I agree with her. Today I am recording myself while I tell a short story. I hope that my English improves with practice. Yesterday I read two chapters, and now I can explain the main idea. In the evening, I usually drink tea and write three short sentences about my day. I enjoy learning English, and I do not want to make my sentences more complicated. I also like reading simple stories. I think that this lesson is important.",
 spellingPairs:[['freind','friend'],['tha','that'],['importan','important']],
 preservedSentences:[
  'My teacher says that simple sentences are useful, and I agree with her.',
  'In the evening, I usually drink tea and write three short sentences about my day.',
  'I enjoy learning English, and I do not want to make my sentences more complicated.',
  'I also like reading simple stories.'
 ],
 selected:[
  {category:'word_order',sentence:'I do not know where is my notebook.',original:'is my notebook',replacement:'my notebook is'},
  {category:'agreement',sentence:'Every morning, my sister walk to the library before breakfast.',original:'walk',replacement:'walks'},
  {category:'verb_form',sentence:'Yesterday I read two chapter, and now I can explains the main idea.',original:'explains',replacement:'explain'}
 ]
};
