# Quiz IBM — TODO

## Project Improvements

### 1. Convert Answer Explanations into Key Takeaways

- [ ] Change answer explanations from paragraph-based text to **bullet-point format**.
- [ ] Keep each explanation concise and focused on the important takeaways.
- [ ] Highlight the key concept or reasoning behind the correct answer.
- [ ] Make explanations easy to scan during result review.
- [ ] Maintain consistency in the explanation format across all quiz questions.

**Expected format:**
- Key concept behind the answer.
- Why the selected answer is correct.
- Important fact/rule to remember.
- Common mistake or misconception, if applicable.

---

### 2. Change Quiz Timer from Countdown to Count-Up

**Current behavior:**
- Timer counts down from the configured quiz duration.

**New behavior:**
- [ ] Change the timer to **count upward from `00:00`**.
- [ ] Display the elapsed time clearly while the candidate is taking the quiz.
- [ ] Continue tracking the total time taken until the quiz is submitted.
- [ ] Store the total quiz completion time.

**Purpose:**
- Help candidates understand how much time they are actually spending on the quiz.
- Encourage better time management.
- Allow candidates to attempt all questions while keeping track of their pace.
- Use the recorded time during result analysis to identify time-management patterns.

---

### 3. Recommend Topics to Review After Quiz Submission

After the candidate submits the quiz:

- [ ] Identify questions answered incorrectly.
- [ ] Map each question to its associated **topic/category/concept**.
- [ ] Group incorrect answers by topic.
- [ ] Identify topics where the candidate has the most mistakes.
- [ ] Recommend specific topics for further study.
- [ ] Display the recommendations clearly in the result/review screen.

**Example:**

> ### Recommended Topics to Review
>
> Based on your incorrect answers, consider reviewing:
>
> - **Networking — TCP/IP**
>   - 3 incorrect answers
> - **Cloud Computing — IBM Cloud Services**
>   - 2 incorrect answers
> - **Database — SQL Queries**
>   - 2 incorrect answers

**Future enhancement:**
- [ ] Link each recommended topic to relevant study material/questions.
- [ ] Allow the candidate to start a practice quiz specifically for a weak topic.
- [ ] Track improvement in each topic across multiple quiz attempts.

---

## Result Analysis

The final quiz review should provide the candidate with:

- [ ] Total score.
- [ ] Total time taken.
- [ ] Correct vs. incorrect answers.
- [ ] Key takeaway explanations for incorrect answers.
- [ ] Topics with the most incorrect answers.
- [ ] Recommended topics for further study.
- [ ] Time-management insights.

### Example Result Summary

```text
Quiz Completed

Score: 78%
Total Time: 24m 36s
Questions: 30

Time Management:
- Total time taken: 24m 36s

Topics to Review:
- Networking — 3 mistakes
- IBM Cloud Services — 2 mistakes
- SQL — 2 mistakes

Recommended Action:
Review the above topics and attempt a targeted practice quiz.
```

## Priority

- [ ] **High:** Count-up timer
- [ ] **High:** Topic-based recommendations
- [ ] **Medium:** Bullet-point answer explanations
- [ ] **Medium:** Time-management analysis
- [ ] **Future:** Topic-specific practice quizzes
