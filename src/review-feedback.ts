export const reviewFeedback = [
  'Trace event handlers through their called functions before claiming an operation ignores a disabled state. A shared guard that prevents side effects is sufficient; duplicate guards are not mandatory.',
  'Trace values through normalization and allowlists before claiming unsafe export or incorrect formatting. A raw intermediate representation is not evidence that raw values reach the final output.',
  'Verify ordinary language and standard-library semantics before reporting them as defects. Array.prototype.some returns false for an empty array; an additional length guard is redundant. Check existing regression tests before proposing equivalent changes.',
  'Treat missing implementation context as uncertainty. A maintainer explanation or previous bot verdict alone does not establish correctness; verify the code for the current head.'
];
