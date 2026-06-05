import { describe, it, expect } from 'vitest';
import { matchShellSecret } from './shell-secrets';

describe('matchShellSecret', () => {
  it('matches export with long secret prefix', () => {
    const line = 'export OPENAI_API_KEY=sk-abc123def456ghi789jkl';
    const m = matchShellSecret(line);
    expect(m).not.toBeNull();
    expect(m!.key).toBe('OPENAI_API_KEY');
    // valueFrom/valueTo span exactly the token (no surrounding spaces)
    const token = line.slice(m!.valueFrom, m!.valueTo);
    expect(token).toBe('sk-abc123def456ghi789jkl');
  });

  it('matches unquoted assignment with trailing inline comment excluded', () => {
    // Unquoted value runs to first whitespace/# — comment stays in the raw line
    const line = 'GITHUB_TOKEN=ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # comment';
    const m = matchShellSecret(line);
    expect(m).not.toBeNull();
    expect(m!.key).toBe('GITHUB_TOKEN');
    const token = line.slice(m!.valueFrom, m!.valueTo);
    expect(token).toBe('ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('matches double-quoted value, rawValue includes quotes, trailing comment excluded', () => {
    const line = 'GITHUB_TOKEN="ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" # comment';
    const m = matchShellSecret(line);
    expect(m).not.toBeNull();
    expect(m!.key).toBe('GITHUB_TOKEN');
    expect(m!.rawValue).toBe('"ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"');
    // Trailing comment is NOT part of the token
    const token = line.slice(m!.valueFrom, m!.valueTo);
    expect(token).toBe('"ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"');
  });

  it('returns null for PATH assignment (not a secret)', () => {
    const m = matchShellSecret('export PATH="$HOME/bin:$PATH"');
    expect(m).toBeNull();
  });

  it('returns null for alias (not an assignment form)', () => {
    const m = matchShellSecret("alias gs='git status'");
    expect(m).toBeNull();
  });

  it('returns null for comment line', () => {
    const m = matchShellSecret('# export TOKEN=sk-xxxx');
    expect(m).toBeNull();
  });

  it('returns null for pure number value', () => {
    const m = matchShellSecret('HISTSIZE=10000');
    expect(m).toBeNull();
  });

  it('handles unterminated double-quote: token runs to EOL', () => {
    const line = 'export TOKEN="sk-abc';
    const m = matchShellSecret(line);
    expect(m).not.toBeNull();
    expect(m!.rawValue).toBe('"sk-abc');
    const token = line.slice(m!.valueFrom, m!.valueTo);
    expect(token).toBe('"sk-abc');
  });

  it('handles leading whitespace + indent correctly (offsets account for indent)', () => {
    const line = '  export SECRET_KEY=verylongsecretvalue123456';
    const m = matchShellSecret(line);
    expect(m).not.toBeNull();
    expect(m!.key).toBe('SECRET_KEY');
    const token = line.slice(m!.valueFrom, m!.valueTo);
    expect(token).toBe('verylongsecretvalue123456');
  });

  it('matches declare keyword', () => {
    const line = 'declare MY_TOKEN=sk-sometoken12345678901234';
    const m = matchShellSecret(line);
    expect(m).not.toBeNull();
    expect(m!.key).toBe('MY_TOKEN');
  });

  it('matches readonly keyword', () => {
    const line = 'readonly API_KEY=sk-readonlytokenabc123456789';
    const m = matchShellSecret(line);
    expect(m).not.toBeNull();
    expect(m!.key).toBe('API_KEY');
  });

  it('matches local keyword', () => {
    const line = 'local SECRET=ghp_localtokenaaaaaaaaaaaaaaaaaaaaa';
    const m = matchShellSecret(line);
    expect(m).not.toBeNull();
    expect(m!.key).toBe('SECRET');
  });

  it('returns null for empty value', () => {
    const m = matchShellSecret('export TOKEN=');
    expect(m).toBeNull();
  });

  it('handles single-quoted value', () => {
    const line = "export MY_SECRET='ghp_singlequotedtoken12345678901'";
    const m = matchShellSecret(line);
    expect(m).not.toBeNull();
    expect(m!.rawValue).toBe("'ghp_singlequotedtoken12345678901'");
    const token = line.slice(m!.valueFrom, m!.valueTo);
    expect(token).toBe("'ghp_singlequotedtoken12345678901'");
  });

  it('picks the correct closing quote past an escaped quote', () => {
    // The escaped \" must NOT be treated as the closing quote, or the tail
    // of the secret would render raw (a leak).
    const line = 'export TOKEN="sk-a\\"bcdefghijklmnopqrs"';
    const m = matchShellSecret(line);
    expect(m).not.toBeNull();
    const token = line.slice(m!.valueFrom, m!.valueTo);
    expect(token).toBe('"sk-a\\"bcdefghijklmnopqrs"');
  });

  it('keeps the full value when it contains additional = signs', () => {
    const line = 'export SECRET=abc=defghijklmnopqrstuvwxyz123';
    const m = matchShellSecret(line);
    expect(m).not.toBeNull();
    expect(m!.key).toBe('SECRET');
    const token = line.slice(m!.valueFrom, m!.valueTo);
    expect(token).toBe('abc=defghijklmnopqrstuvwxyz123');
  });

  it('handles unterminated single-quote: token runs to EOL', () => {
    const line = "export TOKEN='sk-abc";
    const m = matchShellSecret(line);
    expect(m).not.toBeNull();
    const token = line.slice(m!.valueFrom, m!.valueTo);
    expect(token).toBe("'sk-abc");
  });

  it('does NOT mask command substitution even under a secret-looking key', () => {
    expect(matchShellSecret('export SECRET_TOKEN=$(cat /run/secret)')).toBeNull();
    expect(matchShellSecret('export SECRET="$(cat /run/secret)"')).toBeNull();
  });

  it('does NOT mask a variable reference value', () => {
    expect(matchShellSecret('export GITHUB_TOKEN=$OTHER_TOKEN')).toBeNull();
    expect(matchShellSecret('export API_KEY=${SOME_VAR}')).toBeNull();
  });

  it('returns null for quoted-empty value', () => {
    expect(matchShellSecret('export TOKEN=""')).toBeNull();
  });
});
