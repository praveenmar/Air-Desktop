const fs = require('fs');
const path = require('path');

function walkDir(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        if (file === 'node_modules' || file === 'dist' || file === 'out') return;
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            results = results.concat(walkDir(file));
        } else {
            if (file.endsWith('.ts') || file.endsWith('.tsx')) {
                results.push(file);
            }
        }
    });
    return results;
}

const files = [...walkDir('core'), ...walkDir('packages')];

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    const newContent = content.replace(/from\s+['"]([^'"]+)\.ts['"]/g, "from '$1'");
    if (content !== newContent) {
        fs.writeFileSync(file, newContent, 'utf8');
        console.log('Fixed', file);
    }
});
