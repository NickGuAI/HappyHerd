import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { CodeEditor } from '../CodeEditor.web';

function Fixture() {
    const [value, setValue] = React.useState('const count: number = 1;\n');
    const darkMode = new URLSearchParams(window.location.search).get('theme') === 'dark';

    return (
        <main style={{ display: 'flex', height: '100vh', backgroundColor: darkMode ? '#0d1117' : '#ffffff' }}>
            <CodeEditor value={value} onChange={setValue} language="typescript" darkMode={darkMode} />
            <output data-testid="edited-value" hidden>{value}</output>
        </main>
    );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
