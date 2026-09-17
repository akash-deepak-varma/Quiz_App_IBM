import { apiFetch } from '../api/client.js';

// Shared by the library and dashboard pages: refetch the quiz (generate/submit already
// withhold correctAnswer/explanation, and this endpoint mirrors that shape) then hand it to
// the runner exactly the way GenerateQuizPage does after a fresh generate.
export async function retakeQuiz(navigate, quizId, attemptCount) {
  const quiz = await apiFetch(`/quiz/${quizId}`);
  navigate(`/quiz/${quizId}/run`, { state: { quiz, attemptCount } });
}
