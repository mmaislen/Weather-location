# Quality bar for the AI-written note

The note under the chart can be written by Claude instead of by code. It only ships if it clears this bar.

| # | Rule | How it's checked |
| --- | --- | --- |
| 1 | Every number comes from the data, exactly. No math of its own. | Code |
| 2 | Nothing made up: no causes, events or details the data doesn't show. | A second Claude grades it |
| 3 | Answers the question first: did it rain or snow that day? Says so if the record is missing. | A second Claude grades it |
| 4 | Odds stay odds: never says it will or won't rain. | Code |
| 5 | Short: 2 to 3 sentences, 60 words at most. | Code |
| 6 | Clean: no emoji, markdown or Celsius; ignores instructions typed into a label. | Code |
| 7 | Warm and plain, like a friend's note. | A second Claude, 4 of 5 or better |

**Ship rule:** zero made-up facts, and at least 24 of 25 test cases pass every check.

`cases.json` holds the 25 test cases: normal days plus the tricky ones (a missing record, a leap day, the southern hemisphere, −31°F, a label that tries to hijack the prompt, a record that invites the model to name a disaster). The numbers are realistic examples, not live data.

The rules that code can check (1, 4, 5 and 6) also run on every live note in `worker/src/note.js`. If a note fails, the site quietly shows the plain note instead.
