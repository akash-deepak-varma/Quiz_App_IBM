import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import MathText from '../MathText.jsx';

// Starter code is shown as a display default only -- it is NOT auto-seeded into the answer
// map, unlike OrderingQuestion. The starter snippet is definitionally incomplete (a gap) or
// buggy by construction, so submitting it unmodified should legitimately score as incorrect.
export default function CodeQuestion({ question, value, onChange }) {
  const code = value ?? question.starterCode ?? '';

  return (
    <div className="space-y-3">
      <MathText as="p" className="text-lg text-slate-800" text={question.prompt} />
      <div className="overflow-hidden rounded border border-slate-300" role="group" aria-label={question.prompt}>
        <CodeMirror value={code} height="240px" extensions={[javascript()]} onChange={(next) => onChange(next)} />
      </div>
    </div>
  );
}
