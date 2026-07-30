# LexiLift v3 data dictionary

## Core item fields

- `term`: normalized dictionary headword
- `meaning`: one primary learner-friendly sense
- `pattern`: common grammatical frame
- `example`: context-rich complex or compound model sentence
- `collocation`: high-value phrase or sentence frame
- `commonMistake`: frequent grammar, word-order, or register problem
- `synonymOrContrast`: explicit distinction from a related expression
- `pronunciation`: American English IPA and practical sound guidance
- `contextProfile`: domain, role, audience, purpose, and stakes used by the exercise system

## Exercise fields

- `situation`: rich multi-clause background that does not reveal the answer
- `contextMeta`: role, audience, communicative purpose, and reason the wording matters
- `prompt`: task instruction written as a complex or compound sentence
- `meaningCue`: precise sense required by recall and rewrite tasks
- `sentence` or `basicSentence`: pre-authored contextual cloze
- `acceptedAnswers`: dictionary form and valid contextual forms
- `choices`: five unique forms with contrastive feedback
- `modelAnswer`: complete context-rich response

## Progress evidence

Recognition, recall, grammar, collocation, production, retention, and pronunciation remain separate. A recognition click never becomes productive evidence.
