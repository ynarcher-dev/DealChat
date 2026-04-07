import re
import os

log_path = r'C:\Users\Admin\.gemini\antigravity\brain\cbae71ac-73d0-4e12-9062-31f6d3a92bd2\.system_generated\logs\overview.txt'
out_path = r'g:\.shortcut-targets-by-id\1rDq3ilZaYhKKwzY4dRHbmnDNYC0FvfR-\서비스 및 개발 관리\DealChat\js\dealbook_sellers.js'

with open(log_path, 'r', encoding='utf-8') as f:
    text = f.read()

# We need to extract the lines. Since the log might contain other view_files,
# we only want to gather lines that look like "number: content" inside
# the blocks corresponding to dealbook_sellers.js.
# Actually, the simplest is to just parse the whole file for line formats,
# but we might match something else.
# Let's find all blocks of view_file output.
blocks = re.split(r'Showing lines \d+ to \d+', text)

lines_dict = {}

for block in blocks[1:]: # The first block is before the first view_file
    # Check if the block is for dealbook_sellers.js
    if 'The following code has been modified' not in block:
        continue
    
    # Extract lines until we hit "The above content does NOT show" or something similar.
    # Actually, we can just look for lines starting with "1: ", "2: ", etc.
    for line in block.split('\n'):
        m = re.match(r'^(\d+):\s(.*)$', line)
        if m:
            # But wait, what if the line is empty and just "d+:"?
            pass
        m2 = re.match(r'^(\d+):(.*)$', line)
        if m2:
            num = int(m2.group(1))
            content = m2.group(2)
            # Remove the leading space if it exists
            if content.startswith(' '):
                content = content[1:]
            if num <= 2338:
                lines_dict[num] = content

# Let's verify we got lines 1 to 2338
print(f"Extracted {len(lines_dict)} lines.")
missing = [i for i in range(1, 2339) if i not in lines_dict]
if missing:
    print(f"Missing lines: {missing[:10]}...")
else:
    with open(out_path, 'w', encoding='utf-8') as f:
        for i in range(1, max(lines_dict.keys()) + 1):
            f.write(lines_dict.get(i, '') + '\n')
    print("Recovery successful!")
