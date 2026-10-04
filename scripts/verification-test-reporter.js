'use strict';

// The CLI reporter runs outside the isolated test children.
module.exports = async function* reportTestResults(source) {
  const report = { version: 1, files: [], failures: [], warnings: [], summary: null };
  for await (const { type, data } of source) {
    if (type === 'test:summary') {
      if (data.file) report.files.push(data);
      else report.summary = data;
    }
    if (type === 'test:fail') report.failures.push({ file: data.file, name: data.name });
    if (type === 'test:diagnostic' && (data.level === 'warn' || data.level === 'error'
        || /(?:only|runOnly).*--test-only/u.test(data.message))) report.warnings.push(data);
  }
  yield JSON.stringify(report) + '\n';
};
