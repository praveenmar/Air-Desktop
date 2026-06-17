const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

try {
  console.log('1. Building extension source...');
  execSync('npm run build', { stdio: 'inherit' });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'air-vsix-'));
  const packageDir = path.join(tempDir, 'package');
  
  console.log(`2. Copying clean environment to: ${packageDir}`);
  fs.cpSync(__dirname, packageDir, {
    recursive: true,
    filter: (src) => !src.includes('node_modules') && !src.includes('.git')
  });

  const ignoreContent = fs.readFileSync('.vscodeignore', 'utf8') + '\n!node_modules/**\n';
  fs.writeFileSync(path.join(packageDir, '.vscodeignore'), ignoreContent);

  const pkgJsonPath = path.join(packageDir, 'package.json');
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  delete pkgJson.devDependencies;
  fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2));

  console.log('4. Installing isolated production dependencies (Playwright)...');
  // We explicitly disable workspaces so it downloads real files from NPM, not symlinks
  execSync('npm install --omit=dev --no-workspaces', { cwd: packageDir, stdio: 'inherit' });

  console.log('5. Packaging final VSIX...');
  execSync('npx vsce package', { cwd: packageDir, stdio: 'inherit' });

  // Find the generated .vsix and copy it back to our workspace
  const vsixFile = fs.readdirSync(packageDir).find(f => f.endsWith('.vsix'));
  if (!vsixFile) throw new Error('VSIX file not found after vsce package');
  
  fs.copyFileSync(path.join(packageDir, vsixFile), path.join(__dirname, vsixFile));
  console.log(`\n✅ Successfully built ${vsixFile} with all dependencies bundled!`);
  
} catch (err) {
  console.error('\n❌ Build script failed:', err.message);
  process.exit(1);
}
