import { useState } from 'react';
import { ServeError } from '@ffwf/tau-code-protocol';
import type { OpenQuestion } from '@ffwf/tau-code-protocol';
import type { Call } from './line.js';
import { SchemaForm } from './schema-form.js';

export interface QuestionsProps {
  /** The followed cursor's open questions, oldest first. */
  questions: readonly OpenQuestion[];
  client: string;
  call: Call;
}

/**
 * The open questions on the followed cursor: one form each, from the answer's JSON Schema.
 *
 * Questions are raced: the first good answer wins, and every client sees it close. Losing the race
 * (`NotFound`) is information, not a failure. A wrong value (`Refused`) leaves the question open
 * and the form as typed, with τ's sentence. A question addressed to another client is shown, not
 * answerable here.
 */
export function Questions({ questions, client, call }: QuestionsProps): JSX.Element | null {
  const [late, setLate] = useState<string | null>(null);
  if (questions.length === 0 && late === null) return null;
  const send = async (question: OpenQuestion, value: unknown): Promise<void> => {
    try {
      await call('answer', { question: question.id, value });
      setLate(null);
    } catch (error) {
      if (error instanceof ServeError && error.is('NotFound')) {
        setLate(`"${question.text}" was already answered, or closed.`);
        return;
      }
      throw error;
    }
  };
  return (
    <div className="tau-questions" data-testid="questions">
      {late && (
        <div className="tau-info" role="status">
          {late}{' '}
          <button type="button" className="tau-link" onClick={() => setLate(null)}>
            ok
          </button>
        </div>
      )}
      {questions.map((question) =>
        question.to !== null && question.to !== client ? (
          <div key={question.id} className="tau-question tau-hint">
            {question.extension} asks {question.to}: {question.text}
          </div>
        ) : (
          <div key={question.id} className="tau-question" data-question={question.id}>
            <SchemaForm
              idPrefix={`q${question.id}`}
              title={`${question.extension} asks`}
              text={question.text}
              schema={question.schema}
              submitLabel="answer"
              onSubmit={(value) => send(question, value)}
              secondary={{ label: 'decline', onClick: () => send(question, null) }}
            />
          </div>
        ),
      )}
    </div>
  );
}
