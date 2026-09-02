import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';

import { MobileTypographyFloor } from '../MobileTypographyFloor.web';

declare global {
    interface Window {
        __AUTOFOCUS_FONT_SIZES__?: Record<string, string>;
    }
}

function Fixture() {
    const [active, setActive] = React.useState(new URLSearchParams(window.location.search).get('phone') === '1');
    const [showDynamic, setShowDynamic] = React.useState(false);
    const [large, setLarge] = React.useState(false);
    const [revealed, setRevealed] = React.useState(false);
    const [replacedClass, setReplacedClass] = React.useState(false);
    const [autoFocusOwner, setAutoFocusOwner] = React.useState<'agent-question' | 'web-prompt' | null>(null);
    return (
        <>
            <style>{`.orientation-responsive { font-size: 18px } @media (orientation: landscape) { .orientation-responsive { font-size: 12px } }`}</style>
            <button data-testid="toggle-active" onClick={() => setActive((value) => !value)}>toggle</button>
            <button data-testid="add-dynamic" onClick={() => setShowDynamic(true)}>add</button>
            <button data-testid="make-large" onClick={() => setLarge(true)}>large</button>
            <button data-testid="reveal" onClick={() => setRevealed(true)}>reveal</button>
            <button data-testid="replace-class" onClick={() => setReplacedClass(true)}>replace class</button>
            <button data-testid="show-agent-question-autofocus" onClick={() => setAutoFocusOwner('agent-question')}>question autofocus</button>
            <button data-testid="show-web-prompt-autofocus" onClick={() => setAutoFocusOwner('web-prompt')}>prompt autofocus</button>
            <MobileTypographyFloor active={active}>
                <p data-testid="small" className={replacedClass ? 'react-replaced' : 'initial'} style={{ fontSize: large ? 20 : 12 }}>compact status</p>
                <h1 data-testid="heading" style={{ fontSize: 24 }}>Heading</h1>
                <span data-testid="orientation-responsive" className="orientation-responsive">orientation text</span>
                <span data-testid="icon" aria-hidden="true" style={{ fontFamily: 'Ionicons', fontSize: 12 }}>x</span>
                <input data-testid="input" style={{ fontSize: 12 }} placeholder="Input" />
                <textarea data-testid="textarea" style={{ fontSize: 12 }} placeholder="Message" />
                <select data-testid="select" style={{ fontSize: 12 }} defaultValue="one"><option value="one">One</option></select>
                <div data-testid="editable" style={{ fontSize: 12 }} contentEditable suppressContentEditableWarning>Editable</div>
                {showDynamic ? <span data-testid="dynamic" style={{ fontSize: 11 }}>streamed status</span> : null}
                <div data-testid="hidden-root" hidden={!revealed}>
                    <span data-testid="revealed-text" style={{ fontSize: 10 }}>revealed status</span>
                </div>
            </MobileTypographyFloor>
            {createPortal(
                <div data-testid="portal">
                    <span data-testid="portal-text" style={{ fontSize: 10 }}>modal text</span>
                    {autoFocusOwner ? (
                        <textarea
                            key={autoFocusOwner}
                            autoFocus
                            data-testid={`autofocus-${autoFocusOwner}`}
                            placeholder="Custom answer"
                            style={{ fontSize: 16 }}
                            onFocus={(event) => {
                                window.__AUTOFOCUS_FONT_SIZES__ = {
                                    ...window.__AUTOFOCUS_FONT_SIZES__,
                                    [autoFocusOwner]: getComputedStyle(event.currentTarget).fontSize,
                                };
                            }}
                        />
                    ) : null}
                </div>,
                document.body,
            )}
        </>
    );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
