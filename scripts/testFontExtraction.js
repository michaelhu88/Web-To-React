/**
 * Test script for Google font extraction functionality
 */
const path = require('path');
const { extractFonts } = require('../src/extractors/extractFonts');
const fs = require('fs');

// Test URL with Google Fonts
const testUrl = 'https://fonts.google.com';

// Use the standard output directory structure
const outputDir = path.resolve(__dirname, '../output/styles');
const htmlDir = path.resolve(__dirname, '../output/html');
const componentsDir = path.resolve(__dirname, '../output/components');

// Sample CSS with Google font declarations
const cssContent = `
@font-face {
  font-family: 'Roboto';
  src: url('https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxKKTU1Kg.woff2') format('woff2');
}

@font-face {
  font-family: 'Roboto Bold';
  src: url('https://fonts.gstatic.com/s/roboto/v30/KFOlCnqEu92Fr1MmWUlfBBc4.woff2') format('woff2');
  font-weight: 700;
}

/* This is a non-Google font and should be skipped */
@font-face {
  font-family: 'NonGoogleFont';
  src: url('https://example.com/fonts/non-google-font.woff2') format('woff2');
}

body {
  font-family: 'Roboto', sans-serif;
}

h1, h2 {
  font-family: 'Roboto Bold', sans-serif;
}
`;

async function testExtractFonts() {
  // Create mock CSS file objects
  const cssFiles = [
    {
      url: testUrl,
      content: cssContent,
      filename: 'test.css'
    }
  ];

  // Make sure output directories exist
  [outputDir, htmlDir, componentsDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  console.log('🧪 Testing Google font extraction...');
  console.log(`📂 Using output directory: ${outputDir}`);
  
  const result = await extractFonts('', cssFiles, testUrl, outputDir);
  
  console.log('✅ Test complete!');
  console.log(`📊 Results: ${JSON.stringify(result, null, 2)}`);
  
  // Show what files were created
  console.log('\n📁 Created files:');
  if (fs.existsSync(path.join(outputDir, 'test.css'))) {
    console.log(`- ${path.join(outputDir, 'test.css')}`);
  }
  
  if (fs.existsSync(path.join(outputDir, 'font-faces.css'))) {
    console.log(`- ${path.join(outputDir, 'font-faces.css')}`);
    console.log('\n📄 font-faces.css content:');
    console.log(fs.readFileSync(path.join(outputDir, 'font-faces.css'), 'utf8'));
    
    // Verify that only Google fonts were included
    const content = fs.readFileSync(path.join(outputDir, 'font-faces.css'), 'utf8');
    if (content.includes('NonGoogleFont')) {
      console.error('❌ Error: Non-Google font was incorrectly included!');
    } else {
      console.log('✅ Success: Only Google fonts were included!');
    }
  }
  
  const fontsDir = path.join(outputDir, 'fonts');
  if (fs.existsSync(fontsDir)) {
    const fontFiles = fs.readdirSync(fontsDir, { recursive: true });
    console.log('\n📁 Downloaded font files:');
    fontFiles.forEach(file => {
      if (typeof file === 'string') {
        console.log(`- fonts/${file}`);
      }
    });
  }
}

testExtractFonts().catch(err => console.error('❌ Test failed:', err));