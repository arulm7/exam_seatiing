const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const files = [
    'backend/uploads/1769668522352_Student - 29.01.2026.xlsx',
    'backend/uploads/1769668522352_class room - 29.01.2026.xlsx'
];

files.forEach(f => {
    const fullPath = path.resolve(f);
    if (fs.existsSync(fullPath)) {
        console.log(`Reading headers for: ${f}`);
        try {
            const wb = XLSX.readFile(fullPath);
            const ws = wb.Sheets[wb.SheetNames[0]];
            const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
            if (data.length > 0) {
                console.log('Headers:', data[0]);
                // Print first row of data to see values (for time format)
                if (data.length > 1) {
                    console.log('Row 1:', data[1]);
                }
            } else {
                console.log('Empty sheet');
            }
        } catch (e) {
            console.error('Error reading file:', e.message);
        }
    } else {
        console.log(`File not found: ${f}`);
    }
    console.log('---');
});
