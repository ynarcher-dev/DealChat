const fs = require('fs');
const path = require('path');
const targetDir = 'c:/Users/Admin/Documents/GitHub/DealChat/html/';

const files = fs.readdirSync(targetDir).filter(f => f.endsWith('.html'));
files.forEach(f => {
    const filePath = path.join(targetDir, f);
    let original = fs.readFileSync(filePath, 'utf8');
    
    // Remove classes
    let modified = original.replace(/\s*fade-in-(?:down|up)/g, '');
    
    // Remove the `animation: fadeInDown/Up ...;` definition from inline style attributes
    // Sometimes it's the only thing in the style attribute, sometimes part of it.
    // E.g., style="animation: fadeInDown 0.8s ease-out;"  -> style=""
    modified = modified.replace(/animation:\s*fadeIn(?:Down|Up)[^;]*;?\s*/g, '');
    
    // Also remove empty style tags that may have been created
    modified = modified.replace(/style=""\s*/g, '');

    if (original !== modified) {
        fs.writeFileSync(filePath, modified, 'utf8');
        console.log(`Updated ${f}`);
    }
});
