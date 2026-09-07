import McqQuestion from './McqQuestion.jsx';
import CodeQuestion from './CodeQuestion.jsx';
import ShortAnswerQuestion from './ShortAnswerQuestion.jsx';
import OrderingQuestion from './OrderingQuestion.jsx';
import TrueFalseQuestion from './TrueFalseQuestion.jsx';

const COMPONENTS_BY_TYPE = {
  mcq: McqQuestion,
  code_completion: CodeQuestion,
  debug: CodeQuestion,
  short_answer: ShortAnswerQuestion,
  ordering: OrderingQuestion,
  true_false: TrueFalseQuestion,
};

// Keyed by question.id so every question type gets a clean mount when the runner advances,
// rather than a prop update into a reused instance -- OrderingQuestion's seed-on-mount effect
// (and any other per-question local state) depends on this.
export default function QuestionRenderer({ question, value, onChange }) {
  const Component = COMPONENTS_BY_TYPE[question.type];
  if (!Component) {
    return <p className="text-red-600">Unsupported question type: {question.type}</p>;
  }
  return <Component key={question.id} question={question} value={value} onChange={onChange} />;
}
