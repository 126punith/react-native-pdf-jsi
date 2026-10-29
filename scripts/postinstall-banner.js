#!/usr/bin/env node
'use strict';

const path = require('path');

const SPONSOR_URL = 'https://github.com/sponsors/126punith';
const WORKFLOW_URL = '';

function shouldSkip() {
  const env = process.env;
  const truthy = (v) => !!v && v !== '0' && v !== 'false';

  if (
    truthy(env.CI) ||
    truthy(env.CONTINUOUS_INTEGRATION) ||
    env.BUILD_NUMBER ||
    env.RUN_ID ||
    env.GITHUB_ACTIONS ||
    env.GITLAB_CI ||
    env.BUILDKITE ||
    env.CIRCLECI ||
    env.TF_BUILD ||
    env.EAS_BUILD
  ) {
    return true;
  }

  if (
    truthy(env.ADBLOCK) ||
    truthy(env.DISABLE_OPENCOLLECTIVE) ||
    truthy(env.OPEN_SOURCE_CONTRIBUTOR) ||
    truthy(env.RN_PDF_JSI_HIDE_BANNER)
  ) {
    return true;
  }

  if (env.npm_config_loglevel === 'silent') return true;

  // Installing inside this repository itself.
  if (env.INIT_CWD && path.resolve(env.INIT_CWD) === path.resolve(__dirname, '..')) {
    return true;
  }

  return false;
}

function printBanner() {
  const useColor = !process.env.NO_COLOR && process.stdout && process.stdout.isTTY;
  const c = (code) => (s) => (useColor ? `\u001b[${code}m${s}\u001b[0m` : s);
  const bold = c('1');
  const dim = c('2');
  const cyan = c('36');
  const green = c('32');
  const yellow = c('33');
  const magenta = c('35');

  const rule = dim('-'.repeat(72));
  const lines = [
    '',
    rule,
    bold(cyan('  🚀 Thank you for integrating react-native-pdf-jsi!')),
    '',
    '  Rendering and compressing documents 80x faster inside your production',
    '  applications? This project runs entirely on independent developer energy.',
    '',
    bold(yellow('  💼 Using this library inside a commercial app or company product?')),
    '     Consider putting an enterprise sponsorship tier on your corporate',
    '     credit card to back the infrastructure you rely on.',
    '',
    `  ${green('>')} Sponsor the Core & Feature Your Brand Logo: ${bold(magenta(SPONSOR_URL))}`,
  ];

  if (WORKFLOW_URL) {
    lines.push(`  ${green('>')} Check out our local workflow utility:        ${bold(magenta(WORKFLOW_URL))}`);
  }

  lines.push('', dim('  Hide this message: set RN_PDF_JSI_HIDE_BANNER=1'), rule, '');

  process.stdout.write(lines.join('\n') + '\n');
}

try {
  if (!shouldSkip()) printBanner();
} catch (e) {
  // Never block an install.
}

process.exitCode = 0;
