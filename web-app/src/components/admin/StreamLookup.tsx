import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { parseStreamRef } from '../../lib/streamRef';
import { Button } from '../ui';

/** "Stream id or URL" box: paste a streambird.app/streams/<uuid> link (or the bare id) to see which brand kit that stream resolves to. */
export function StreamLookup() {
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const navigate = useNavigate();

  function go(e: FormEvent) {
    e.preventDefault();
    const id = parseStreamRef(value);
    if (!id) {
      setProblem('That is not a stream id or a streambird.app/streams/... link.');
      return;
    }
    setProblem(null);
    navigate(`/admin/streams/${id}`);
  }

  return (
    <form className="admin-lookup" onSubmit={go} data-testid="stream-lookup" role="search" aria-label="Find a stream">
      <input
        type="search"
        className="ui-input"
        aria-label="Stream id or URL"
        placeholder="Stream id or URL (https://streambird.app/streams/…)"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setProblem(null);
        }}
      />
      <Button type="submit" variant="secondary">
        Look up stream
      </Button>
      {problem && (
        <p className="error" role="alert" style={{ flexBasis: '100%', margin: 0 }}>
          {problem}
        </p>
      )}
    </form>
  );
}
