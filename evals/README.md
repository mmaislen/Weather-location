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

## Results so far (2026-11-16)

| Run | Prompt | Writer model | Passed all checks | Flagged as made up |
| --- | --- | --- | --- | --- |
| 1 | v1 | Claude, quick tier | 2 / 25 | 2 |
| 2 | v1 | Claude Opus 5.5, low effort (the live model) | 17 / 25 | 2 |
| 3 | v2 | Claude Opus 5.5, low effort | 17 / 25 | 4 |
| 4 | v3 | Claude Opus 5.5, low effort | 17 / 25 | 4 |

What each round taught:
- **v1** never invented a number, but read like a weather report and called the birth year a "first birthday".
- **Changing to the live model** did more than any prompt change.
- **v2** asked for one surprising pattern in 3 sentences. It read far better, but miscounted ("27 years since"), used outside knowledge ("rare luck for Seattle") and gave advice.
- **v3** fixed those. Its remaining flags were the grader being strict ("scorching" for 108°F, "next year" for 2027, tone 3 of 5 on plain notes).
- **The checkers needed fixing too.** The code check flagged "nothing's guaranteed" as a promise, and the grader rejected "the day Theo was born" for "Theo's birthday". Both were corrected, so scores across runs aren't strictly comparable.

**Decision:** shipped v3 short of the 24/25 bar. Every number on every note matched the data, the remaining flags were judgment calls by the grader, and the code-checkable rules run on every live note before visitors see it. Next: have a person review the grader's flags to calibrate it.

Raw results for each run are in `results/`. `scorecard.html` is the page that ran them.
