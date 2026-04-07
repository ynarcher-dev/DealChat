const fs = require('fs');
const readline = require('readline');

const logPath = 'C:\\Users\\Admin\\.gemini\\antigravity\\brain\\cbae71ac-73d0-4e12-9062-31f6d3a92bd2\\.system_generated\\logs\\overview.txt';
const outPath = 'g:\\.shortcut-targets-by-id\\1rDq3ilZaYhKKwzY4dRHbmnDNYC0FvfR-\\서비스 및 개발 관리\\DealChat\\js\\dealbook_sellers.js';

async function processLineByLine() {
  const fileStream = fs.createReadStream(logPath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let linesDict = {};
  let inViewFileBlock = false;

  for await (const line of rl) {
    if (line.includes('The following code has been modified to include a line number')) {
      inViewFileBlock = true;
      continue;
    }
    if (inViewFileBlock && line.includes('The above content does NOT show')) {
      inViewFileBlock = false;
      continue;
    }
    if (inViewFileBlock && line.includes('The above content shows the entire')) {
      inViewFileBlock = false;
      continue;
    }

    if (inViewFileBlock) {
      const match = line.match(/^(\d+):\s?(.*)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        const content = match[2];
        if (num <= 2338) {
          linesDict[num] = content;
        }
      }
    }
  }

  const keys = Object.keys(linesDict).map(Number).sort((a, b) => a - b);
  console.log(`Extracted ${keys.length} lines.`);
  
  if (keys.length > 0) {
    const maxLine = Math.max(...keys);
    let output = '';
    for (let i = 1; i <= maxLine; i++) {
        output += (linesDict[i] !== undefined ? linesDict[i] : '') + '\n';
    }
    fs.writeFileSync(outPath, output, 'utf8');
    console.log('Recovery successful!');
  } else {
    console.log('Failed to extract any lines.');
  }
}

processLineByLine();
