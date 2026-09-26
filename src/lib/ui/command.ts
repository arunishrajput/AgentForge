/**
 * The command palette's matching.
 *
 * Separated from the component because this is the only part of a palette that can
 * actually be wrong: the dialog either opens or it does not, but "why is the thing
 * I typed not first?" is a judgement made in about fifteen lines of arithmetic, and
 * those fifteen lines deserve tests rather than a squint.
 *
 * The ranking is deliberately crude and explainable, in this order:
 *
 *   an exact title      typing a workflow's whole name puts it first
 *   a title prefix      what a user is doing when they type three letters
 *   a word start        "work" in "New workflow", which reads as a match
 *   anywhere in a title
 *   a subsequence       "nwf" → "New workflow", the fuzzy case, ranked last
 *                       because it is the one that produces surprising hits
 *
 * A subtitle or a keyword can match too, at a discount, so "gemini" can reach
 * "Settings" without "Gemini" being in its title.
 *
 * **The subsequence tier applies to the title alone**, and that is a correction made
 * in Phase 16 rather than an original nicety. A subsequence is the "type the initials
 * of a name" affordance, and it only means anything against something short: any long
 * sentence contains almost any five-letter subsequence. When the node palette began
 * offering each node's *description* as a subtitle, searching "gmail" matched seven of
 * fifteen nodes — "Schedule trigger", "Loop" and "LLM" among them — because every one
 * of their descriptions happens to contain g…m…a…i…l in order. A search that returns
 * half the catalogue is not a search. Substring and word-start matching on a subtitle
 * stay, because those are real matches; only the fuzzy tier is withdrawn from it.
 *
 * Every term in a multi-word query has to match something. Typing a second word
 * narrows; a palette where it widened would answer a longer query with a longer
 * list, which is the opposite of what the typing was for.
 */

export type Command = {
  id: string;
  title: string;
  subtitle?: string;
  keywords?: string[];
};

const EXACT = 100;
const PREFIX = 80;
const WORD_START = 60;
const ANYWHERE = 40;
const SUBSEQUENCE = 15;

/** Word boundaries a human reads as the start of a word. */
const BOUNDARY = /[\s\-_/.:]/;

function isSubsequence(haystack: string, needle: string): boolean {
  let at = 0;
  for (const character of needle) {
    at = haystack.indexOf(character, at);
    if (at === -1) return false;
    at += 1;
  }
  return true;
}

/** `fuzzy` enables the subsequence tier. Only a title gets it — see the note above. */
function scoreText(text: string, needle: string, fuzzy: boolean): number | null {
  const haystack = text.toLowerCase();
  if (haystack === needle) return EXACT;
  if (haystack.startsWith(needle)) return PREFIX;

  const at = haystack.indexOf(needle);
  if (at > 0) return BOUNDARY.test(haystack.charAt(at - 1)) ? WORD_START : ANYWHERE;

  return fuzzy && isSubsequence(haystack, needle) ? SUBSEQUENCE : null;
}

/** The best score any field of this command can offer for one term. */
function scoreTerm(command: Command, term: string): number | null {
  const scores: number[] = [];

  const title = scoreText(command.title, term, true);
  if (title !== null) scores.push(title);

  if (command.subtitle) {
    const subtitle = scoreText(command.subtitle, term, false);
    if (subtitle !== null) scores.push(subtitle * 0.5);
  }

  for (const keyword of command.keywords ?? []) {
    const score = scoreText(keyword, term, false);
    if (score !== null) scores.push(score * 0.7);
  }

  return scores.length === 0 ? null : Math.max(...scores);
}

export function scoreCommand(command: Command, query: string): number | null {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 0;

  let total = 0;
  for (const term of terms) {
    const score = scoreTerm(command, term);
    if (score === null) return null;
    total += score;
  }
  return total / terms.length;
}

/**
 * Filter and rank. An empty query returns the list untouched, which is what makes
 * the palette useful before a single key is pressed: it is a menu first and a
 * search second.
 *
 * Ties keep their input order — the caller groups commands meaningfully, and
 * reshuffling equal matches would make the list jump for no reason the user can see.
 */
export function rankCommands<T extends Command>(commands: T[], query: string): T[] {
  if (query.trim().length === 0) return [...commands];

  return commands
    .map((command, index) => ({ command, index, score: scoreCommand(command, query) }))
    .filter((entry): entry is { command: T; index: number; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.command);
}
