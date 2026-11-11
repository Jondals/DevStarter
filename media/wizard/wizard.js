/**
 * media/wizard/wizard.js
 * ──────────────────────
 * Page script of the visual New Project wizard (runs inside the webview, not in Node).
 *
 * It is deliberately "dumb": it draws the view model sent by src/webview/wizardPanel.ts and
 * reports clicks back. Every rule (what applies, validation, summaries) lives in the extension.
 *
 * Messages:
 *   ← init { cards, view }   first paint
 *   ← view { view }          redraw after every change
 *   → ready | level | start | home | set | toggle | browse | create | quick
 *
 * ! Keep the message shapes in sync with src/webview/wizardPanel.ts.
 * * Project style: regular functions, no arrow functions.
 */
(function () {
    'use strict';

    // eslint-disable-next-line no-undef
    const vscode = acquireVsCodeApi();
    const app = document.getElementById('app');

    /** Filter chips of the pick screen, in order. */
    const FILTERS = ['All', 'Ideas', 'Frontend', 'Full-stack', 'Backend', 'Mobile', 'Desktop', 'Other'];

    /** Headings of each group when no filter is active. */
    const GROUP_TITLES = {
        Ideas: ['Start from an idea', 'No experience needed: DevStarter picks the right tools for you.'],
        Frontend: ['Frontend', 'Websites and interfaces.'],
        'Full-stack': ['Full-stack', 'Frontend and backend in one framework.'],
        Backend: ['Backend', 'APIs and servers.'],
        Mobile: ['Mobile', 'Apps for your phone.'],
        Desktop: ['Desktop & browser', 'Apps for your computer and browser extensions.'],
        Other: ['Other', 'Scripts, bots and more.'],
    };

    /** Everything the page remembers between messages. */
    const state = {
        cards: [],
        view: undefined,
        filter: 'All',
        query: '',
        /** Template id the configure layout was built for (rebuilt only when it changes). */
        layoutFor: undefined,
        /** Beginner + layout the configure screen was built for. */
        layoutBeginner: undefined,
        /** Beginners: show every technology instead of the short list. */
        showAll: false,
        /** Beginners: the optional settings are open. */
        customize: false,
        nameTimer: undefined,
    };

    // ─── Tiny DOM helpers ───────────────────────────────────────────

    /**
     * Creates an element.
     * @param {string} tag tag name, optionally with classes: "div.card.selected"
     * @param {object} [attrs] attributes; "on<event>" keys become listeners
     * @param {...(Node|string|undefined|false)} children child nodes or text
     */
    function h(tag, attrs) {
        const hash = tag.split('#');
        const parts = hash[0].split('.');
        const el = document.createElement(parts[0]);
        if (parts.length > 1) {
            el.className = parts.slice(1).join(' ');
        }
        if (hash[1]) {
            el.id = hash[1];
        }
        for (const key in attrs || {}) {
            const value = attrs[key];
            if (value === undefined || value === false || value === null) {
                continue;
            }
            if (key.startsWith('on')) {
                el.addEventListener(key.slice(2), value);
            } else if (key === 'text') {
                el.textContent = value;
            } else if (key === 'vars') {
                // ! The CSP blocks style="" attributes; CSS variables set through the CSSOM are allowed.
                for (const name in value) {
                    el.style.setProperty(name, String(value[name]));
                }
            } else {
                el.setAttribute(key, value === true ? '' : value);
            }
        }
        for (let i = 2; i < arguments.length; i++) {
            append(el, arguments[i]);
        }
        return el;
    }

    /**
     * Appends children (arrays, nodes or text), skipping empty ones.
     * @param {Element} el parent
     * @param {*} child child or list of children
     */
    function append(el, child) {
        if (child === undefined || child === null || child === false) {
            return;
        }
        if (Array.isArray(child)) {
            child.forEach(function (c) {
                append(el, c);
            });
        } else {
            el.append(child instanceof Node ? child : document.createTextNode(String(child)));
        }
    }

    /**
     * Replaces all children of an element, skipping empty ones.
     * ? Unlike el.replaceChildren(), `undefined` children are ignored instead of printed as "undefined".
     * @param {Element} el parent
     * @param {...*} children new children
     */
    function setChildren(el) {
        el.replaceChildren();
        for (let i = 1; i < arguments.length; i++) {
            append(el, arguments[i]);
        }
    }

    /**
     * A codicon.
     * @param {string} name codicon name (e.g. "rocket")
     */
    function icon(name) {
        return h('i.codicon.codicon-' + name, { 'aria-hidden': 'true' });
    }

    /** Technology logos: { slug: { hex, path } } from media/wizard/logos.js. */
    // eslint-disable-next-line no-undef
    const LOGOS = window.DEVSTARTER_LOGOS || {};

    /**
     * Relative luminance of a brand color (0 = black, 1 = white).
     * @param {string} hex color without "#"
     */
    function luminance(hex) {
        const c = [0, 2, 4].map(function (i) {
            const v = parseInt(hex.slice(i, i + 2), 16) / 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    }

    /**
     * The SVG of one logo, or undefined if there is none.
     * @param {string} slug logo id
     */
    function logoSvg(slug) {
        const data = LOGOS[slug];
        if (!data) {
            return undefined;
        }
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('d', data.path);
        svg.append(path);
        return svg;
    }

    /**
     * A square "mark": the technology logo in its brand color, or a codicon when there is no logo.
     * ? Very dark logos (Next.js, Rust…) switch to the text color on dark themes and very light
     * ? ones (JavaScript, Pinia…) get darker on light themes, so every logo stays visible.
     * @param {string[]|undefined} logos logo slugs; the first one that exists is used
     * @param {string|undefined} iconName fallback codicon
     * @param {string} size "sm", "md", "lg" or "xl"
     */
    function mark(logos, iconName, size) {
        const slug = (logos || []).find(function (s) {
            return LOGOS[s];
        });
        if (!slug) {
            return h('span.mark.plain.' + size, {}, icon(iconName || 'circle-large-outline'));
        }
        const hex = LOGOS[slug].hex;
        const l = luminance(hex);
        const tone = l < 0.06 ? '.ink-dark' : l < 0.2 ? '.ink-mid' : l > 0.5 ? '.ink-light' : '';
        return h('span.mark.' + size + tone, { vars: { '--brand': '#' + hex } }, logoSvg(slug));
    }

    /**
     * Several small overlapping logos (the stack of an idea or of the project).
     * @param {string[]|undefined} logos logo slugs
     * @param {string} [size] mark size (default "xs")
     */
    function stack(logos, size) {
        const items = (logos || []).filter(function (s) {
            return LOGOS[s];
        });
        if (!items.length) {
            return undefined;
        }
        return h(
            'span.stack',
            {},
            items.map(function (s) {
                return mark([s], undefined, size || 'xs');
            }),
        );
    }

    /**
     * The DevStarter logo (media/icon.png).
     * @param {string} extra extra classes, e.g. ".big"
     */
    function brandLogo(extra) {
        return h('img.logo' + extra, { src: app.dataset.logo, alt: '' });
    }

    /** Technologies beginners see first (the most used, one or two per kind). */
    const POPULAR = ['react', 'vanilla', 'next', 'python-script', 'expo', 'express'];

    /** Ideas beginners see first; the rest appear with "See all". */
    const FIRST_IDEAS = ['portfolio', 'game', 'ai-chat', 'store', 'landing', 'mobile', 'webapp', '3d'];

    /**
     * Sends a message to the extension.
     * @param {object} message message to send
     */
    function send(message) {
        vscode.postMessage(message);
    }

    // ─── Shared pieces ──────────────────────────────────────────────

    /** Top bar: logo, experience switch and quick-mode link. */
    function topBar() {
        const v = state.view;
        return h(
            'header.topbar',
            {},
            h('div.brand', {}, brandLogo(''), h('span', { text: 'DevStarter' })),
            h(
                'div.topbar-actions',
                {},
                h(
                    'div.segmented.small',
                    { role: 'radiogroup', 'aria-label': 'Experience level' },
                    segment('Beginner', 'heart', v.beginner, function () {
                        send({ type: 'level', beginner: true });
                    }),
                    segment('Experienced', 'zap', !v.beginner, function () {
                        send({ type: 'level', beginner: false });
                    }),
                ),
                h(
                    'button.link',
                    {
                        title: 'Use the keyboard-driven lists instead (you can make it the default in Settings)',
                        onclick: function () {
                            send({ type: 'quick' });
                        },
                    },
                    icon('list-selection'),
                    ' Quick mode',
                ),
            ),
        );
    }

    /**
     * One button of a segmented control.
     * @param {string} label text
     * @param {string|undefined} iconName codicon
     * @param {boolean} selected currently chosen
     * @param {Function} onclick click handler
     * @param {string} [hint] small text under the label
     */
    function segment(label, iconName, selected, onclick, hint) {
        return h(
            'button.segment' + (selected ? '.selected' : ''),
            { role: 'radio', 'aria-checked': selected ? 'true' : 'false', onclick: onclick },
            iconName && icon(iconName),
            h('span', { text: label }),
            hint && h('small', { text: hint }),
        );
    }

    /**
     * Small "Recommended" badge, only for beginners.
     * @param {boolean} show the option is recommended
     */
    function badge(show) {
        return show && state.view.beginner ? h('span.badge', { text: 'Recommended' }) : undefined;
    }

    // ─── Screen: experience level ───────────────────────────────────

    /** First-run question: how much coding experience? */
    function renderLevel() {
        app.className = 'screen level';
        setChildren(
            app,
            h(
                'div.hero.center',
                {},
                brandLogo('.big'),
                h('h1', {}, 'Welcome to ', h('span.gradient', { text: 'DevStarter' })),
                h('p.lead', { text: 'First time here! How much coding experience do you have?' }),
            ),
            h(
                'div.level-grid',
                {},
                levelCard(
                    true,
                    'heart',
                    "I'm new to programming",
                    'Simple screens: pick an idea, give it a name, done. Explanations everywhere and a step-by-step guide.',
                ),
                levelCard(
                    false,
                    'zap',
                    'I already know how to code',
                    'The full catalog and every option on one screen: backend, database, libraries, CI, Docker…',
                ),
            ),
            h('p.muted.center', { text: 'You can change this at any time from the top bar.' }),
        );
    }

    /**
     * A big card of the level screen.
     * @param {boolean} beginner value it sets
     * @param {string} iconName codicon
     * @param {string} title card title
     * @param {string} text explanation
     */
    function levelCard(beginner, iconName, title, text) {
        return h(
            'button.card.level-card',
            {
                onclick: function () {
                    send({ type: 'level', beginner: beginner });
                },
            },
            h('span.mark.idea-mark.lg', {}, icon(iconName)),
            h('strong', { text: title }),
            h('p', { text: text }),
        );
    }

    // ─── Screen: pick an idea or a technology ───────────────────────

    /** Draws the pick screen (search, filters and cards). */
    function renderPick() {
        const v = state.view;
        app.className = 'screen pick';
        const search = h('input.search', {
            type: 'search',
            placeholder: 'Search: react, 3D, game, API, python…  (press / to focus)',
            'aria-label': 'Search projects',
            value: state.query,
            oninput: function (e) {
                const wasSimple = simpleList();
                state.query = e.target.value;
                if (wasSimple !== simpleList()) {
                    renderPick();
                    document.querySelector('.search').focus();
                } else {
                    renderCards();
                }
            },
        });
        setChildren(
            app,
            topBar(),
            h(
                'div.hero',
                {},
                h('h1', {}, 'What do you want to ', h('span.gradient', { text: v.beginner ? 'make?' : 'build?' })),
                h('p.lead', {
                    text: v.beginner
                        ? 'Pick an idea or a technology. Everything can be changed on the next screen.'
                        : 'Pick a stack. Backend, database, libraries and extras come next.',
                }),
                h('div.search-wrap', {}, icon('search'), search),
                !simpleList() &&
                    h(
                        'div.chips',
                        { role: 'tablist' },
                        FILTERS.map(function (f) {
                            return h(
                                'button.chip' + (state.filter === f ? '.selected' : ''),
                                {
                                    role: 'tab',
                                    'aria-selected': state.filter === f ? 'true' : 'false',
                                    onclick: function () {
                                        state.filter = f;
                                        renderPick();
                                    },
                                },
                                f,
                                h('span.chip-count', { text: String(countFor(f)) }),
                            );
                        }),
                    ),
            ),
            v.last &&
                h(
                    'button.card.repeat',
                    {
                        onclick: function () {
                            send({ type: 'start', kind: 'repeat' });
                        },
                    },
                    h('span.mark.plain.md', {}, icon('history')),
                    h('div', {}, h('strong', { text: 'Repeat last setup' }), h('p.mono', { text: v.last })),
                    icon('chevron-right'),
                ),
            h('div#cards'),
        );
        renderCards();
    }

    /**
     * How many cards a filter chip shows.
     * @param {string} filter chip name
     */
    function countFor(filter) {
        return state.cards.filter(function (c) {
            return filter === 'All' || c.category === filter;
        }).length;
    }

    /**
     * Whether a card matches the search text.
     * @param {object} card card to check
     * @param {string} query lowercase search text
     */
    function matches(card, query) {
        if (!query) {
            return true;
        }
        const text = [card.label, card.description, card.detail, card.category, card.id].join(' ').toLowerCase();
        return query.split(/\s+/).every(function (word) {
            return text.includes(word);
        });
    }

    /** Beginners without a search see ideas + a few popular technologies, not the whole catalog. */
    function simpleList() {
        return state.view.beginner && !state.showAll && !state.query.trim();
    }

    /**
     * The beginner list: every idea, the most used technologies and a "see all" button.
     * @param {Element} container where to draw
     */
    function renderSimple(container) {
        const ideas = FIRST_IDEAS.map(function (id) {
            return state.cards.find(function (c) {
                return c.kind === 'preset' && c.id === id;
            });
        }).filter(Boolean);
        const popular = POPULAR.map(function (id) {
            return state.cards.find(function (c) {
                return c.kind === 'template' && c.id === id;
            });
        }).filter(Boolean);
        const total = state.cards.length;
        container.replaceChildren(
            h(
                'section.group',
                {},
                h(
                    'div.group-head',
                    {},
                    h('h2', { text: 'Start from an idea' }),
                    h('span.muted', { text: 'No experience needed: DevStarter picks the right tools for you.' }),
                ),
                h('div.grid', {}, ideas.map(card)),
            ),
            h(
                'section.group',
                {},
                h(
                    'div.group-head',
                    {},
                    h('h2', { text: 'Or pick a technology' }),
                    h('span.muted', { text: 'The most used ones.' }),
                ),
                h('div.grid', {}, popular.map(card)),
            ),
            h(
                'button.see-all',
                {
                    onclick: function () {
                        state.showAll = true;
                        renderPick();
                    },
                },
                icon('list-unordered'),
                ' See all ' + total + ' ideas and technologies',
            ),
        );
    }

    /** Draws the card grid for the current filter and search. */
    function renderCards() {
        const container = document.getElementById('cards');
        if (simpleList()) {
            renderSimple(container);
            return;
        }
        const query = state.query.trim().toLowerCase();
        const visible = state.cards.filter(function (c) {
            return (state.filter === 'All' || c.category === state.filter) && matches(c, query);
        });
        if (!visible.length) {
            container.replaceChildren(h('p.empty', {}, icon('search'), ' Nothing matches "' + state.query + '".'));
            return;
        }
        // * Beginners see ideas first; experienced users see technologies first.
        const order = state.view.beginner ? FILTERS.slice(1) : FILTERS.slice(2).concat(['Ideas']);
        const groups = [];
        order.forEach(function (category) {
            const items = visible.filter(function (c) {
                return c.category === category;
            });
            if (!items.length) {
                return;
            }
            if (state.view.beginner) {
                items.sort(function (a, b) {
                    return Number(b.recommended) - Number(a.recommended);
                });
            }
            const title = GROUP_TITLES[category];
            groups.push(
                h(
                    'section.group.' +
                        categoryClass({ kind: category === 'Ideas' ? 'preset' : 'template', category: category }),
                    {},
                    h(
                        'div.group-head',
                        {},
                        h('h2', { text: title[0] }),
                        h('span.count', { text: String(items.length) }),
                        h('span.muted', { text: title[1] }),
                    ),
                    h('div.grid', {}, items.map(card)),
                ),
            );
        });
        container.replaceChildren.apply(container, groups);
    }

    /**
     * One idea / technology card.
     * @param {object} c card data
     * @param {number} i position (for the entrance animation)
     */
    function card(c, i) {
        return h(
            'button.card.pick-card.' + categoryClass(c) + (c.kind === 'preset' ? '.idea' : ''),
            {
                vars: { '--i': Math.min(i, 12) },
                title: c.detail,
                onclick: function () {
                    send({ type: 'start', kind: c.kind, id: c.id });
                },
            },
            h(
                'div.card-top',
                {},
                c.kind === 'preset' ? h('span.mark.idea-mark.lg', {}, icon(c.icon)) : mark(c.logos, c.icon, 'lg'),
                badge(c.recommended),
            ),
            h('strong.card-title', { text: c.label }),
            h('span.tag', { text: c.description }),
            h('p', { text: c.detail }),
            h(
                'div.card-foot',
                {},
                c.kind === 'preset' ? stack(c.logos) : undefined,
                h('span.card-go', {}, c.kind === 'preset' ? 'Start' : 'Use', icon('arrow-right')),
            ),
        );
    }

    /**
     * CSS class with the accent color of a card's category.
     * @param {object} c card data
     */
    function categoryClass(c) {
        return 'cat-' + (c.kind === 'preset' ? 'ideas' : c.category.toLowerCase().replace(/[^a-z]/g, ''));
    }

    // ─── Screen: configure ──────────────────────────────────────────

    /**
     * A section of the configure screen.
     * @param {string} id element id (its body is redrawn on every update)
     * @param {string} iconName codicon
     * @param {string} title heading
     * @param {string} hint short explanation
     */
    function section(id, iconName, title, hint) {
        return h(
            'section.card.panel#' + id,
            { id: id },
            h(
                'div.panel-head',
                {},
                h('span.panel-icon', {}, icon(iconName)),
                h('div', {}, h('h2', { text: title }), h('p.muted', { text: hint })),
            ),
            h('div.panel-body'),
        );
    }

    /** Builds the configure layout (only when the template changes, so the name field keeps focus). */
    function buildConfigure() {
        const v = state.view;
        app.className = 'screen configure';
        const nameInput = h('input.name#name', {
            id: 'name',
            type: 'text',
            spellcheck: 'false',
            autocomplete: 'off',
            'aria-describedby': 'name-error',
            value: v.name,
            oninput: function (e) {
                clearTimeout(state.nameTimer);
                const value = e.target.value;
                state.nameTimer = setTimeout(function () {
                    send({ type: 'set', field: 'name', value: value });
                }, 120);
            },
            onkeydown: function (e) {
                if (e.key === 'Enter') {
                    create();
                }
            },
        });
        /** Name & location section. */
        function where() {
            return h(
                'section.card.panel#sec-where',
                { id: 'sec-where' },
                h(
                    'div.panel-head',
                    {},
                    h('span.panel-icon', {}, icon('folder')),
                    h(
                        'div',
                        {},
                        h('h2', { text: 'Name & location' }),
                        h('p.muted', { text: 'Where the project folder will be created.' }),
                    ),
                ),
                h('div.panel-body', {}, h('div.tiles.folders#folders', { id: 'folders' })),
                h('label.field-label', { for: 'name', text: 'Project name' }),
                nameInput,
                h('p.error#name-error', { id: 'name-error', role: 'alert' }),
            );
        }
        setChildren(
            app,
            topBar(),
            h(
                'div.config-head',
                {},
                h(
                    'button.back',
                    {
                        onclick: function () {
                            send({ type: 'home' });
                        },
                    },
                    icon('arrow-left'),
                    ' All projects',
                ),
                h(
                    'div.config-title',
                    {},
                    h('span.tpl-mark#tpl-icon', { id: 'tpl-icon' }),
                    h('div', {}, h('h1', { id: 'tpl-label' }), h('p.muted.mono', { id: 'tpl-desc' })),
                ),
            ),
            h(
                'div.layout',
                {},
                h(
                    'main.sections',
                    {},
                    v.beginner && where(),
                    v.beginner &&
                        h(
                            'button.customize' + (state.customize ? '.open' : ''),
                            {
                                'aria-expanded': state.customize ? 'true' : 'false',
                                onclick: function (e) {
                                    state.customize = !state.customize;
                                    e.currentTarget.classList.toggle('open', state.customize);
                                    e.currentTarget.setAttribute('aria-expanded', String(state.customize));
                                    document.getElementById('optional').hidden = !state.customize;
                                },
                            },
                            icon('settings'),
                            h(
                                'span',
                                {},
                                h('strong', { text: 'Customize (optional)' }),
                                h('small', {
                                    text: 'Language, backend, database, libraries, GitHub and more. DevStarter already chose good defaults.',
                                }),
                            ),
                            icon('chevron-down'),
                        ),
                    h(
                        'div.optional#optional',
                        { id: 'optional', hidden: v.beginner && !state.customize },
                        section(
                            'sec-lang',
                            'symbol-type-parameter',
                            'Language',
                            'TypeScript catches mistakes before you run the code.',
                        ),
                        section(
                            'sec-backend',
                            'server',
                            'Backend',
                            'An API for your frontend, in its own folder, already connected.',
                        ),
                        section('sec-db', 'database', 'Database', ''),
                        section(
                            'sec-libs',
                            'library',
                            'Libraries',
                            'Popular packages, installed and wired in. All optional.',
                        ),
                        section('sec-extras', 'settings-gear', 'Extras', 'Git, GitHub, Docker, CI and more.'),
                        section('sec-pm', 'package', 'Package manager', 'The tool that installs JavaScript packages.'),
                    ),
                    !v.beginner && where(),
                ),
                h('aside.summary#summary', { id: 'summary' }),
            ),
        );
        state.layoutFor = v.template.id;
        state.layoutBeginner = v.beginner;
    }

    /** Fills every part of the configure screen from the current view. */
    function updateConfigure() {
        const v = state.view;
        if (
            state.layoutFor !== v.template.id ||
            state.layoutBeginner !== v.beginner ||
            !document.getElementById('summary')
        ) {
            buildConfigure();
        }
        document.getElementById('tpl-icon').replaceChildren(mark(v.template.logos, v.template.icon, 'xl'));
        document.getElementById('tpl-label').textContent = v.template.label;
        document.getElementById('tpl-desc').textContent = v.template.description;

        fill('sec-lang', v.typescript !== undefined && languageBody(v));
        fill('sec-backend', v.backends && tiles(v.backends, 'backend'));
        fill(
            'sec-db',
            v.database && tiles(v.database.options, 'database'),
            v.database && 'Stored by ' + v.database.owner + '. SQLite needs nothing else installed.',
        );
        fill('sec-libs', v.libraries.length && librariesBody(v));
        fill('sec-extras', v.extras.length && extrasBody(v));
        fill('sec-pm', v.packageManagers && tiles(v.packageManagers, 'pm', true));
        foldersBody(v);

        const name = document.getElementById('name');
        if (document.activeElement !== name && name.value !== v.name) {
            name.value = v.name;
        }
        name.classList.toggle('invalid', !!v.nameError);
        document.getElementById('name-error').textContent = v.nameError || '';
        summaryBody(v);
    }

    /**
     * Shows a section with new content, or hides it when it does not apply.
     * @param {string} id section id
     * @param {Node|false|undefined} body new content (falsy hides the section)
     * @param {string} [hint] new hint text
     */
    function fill(id, body, hint) {
        const el = document.getElementById(id);
        el.hidden = !body;
        if (body) {
            el.querySelector('.panel-body').replaceChildren(body);
            if (hint) {
                el.querySelector('.panel-head p').textContent = hint;
            }
        }
    }

    /**
     * Language segmented control.
     * @param {object} v view
     */
    function languageBody(v) {
        return h(
            'div.segmented',
            { role: 'radiogroup', 'aria-label': 'Language' },
            segment(
                'TypeScript',
                'symbol-type-parameter',
                v.typescript,
                function () {
                    send({ type: 'set', field: 'typescript', value: true });
                },
                v.beginner ? 'safer · recommended' : 'recommended',
            ),
            segment(
                'JavaScript',
                'symbol-variable',
                !v.typescript,
                function () {
                    send({ type: 'set', field: 'typescript', value: false });
                },
                'simpler, no types',
            ),
        );
    }

    /**
     * Single-choice tiles (backend, database, package manager).
     * @param {Array<object>} options view options
     * @param {string} field field sent on click
     * @param {boolean} [compact] smaller tiles
     */
    function tiles(options, field, compact) {
        return h(
            'div.tiles' + (compact ? '.compact' : ''),
            { role: 'radiogroup' },
            options.map(function (o) {
                return h(
                    'button.tile' + (o.selected ? '.selected' : ''),
                    {
                        role: 'radio',
                        'aria-checked': o.selected ? 'true' : 'false',
                        title: o.detail,
                        onclick: function () {
                            send({ type: 'set', field: field, value: o.id });
                        },
                    },
                    h(
                        'div.tile-top',
                        {},
                        (o.logos || o.icon) && mark(o.logos, o.icon, 'sm'),
                        h('strong', { text: o.label }),
                        badge(o.recommended),
                    ),
                    o.description && h('span.muted.mono', { text: o.description }),
                    state.view.beginner && o.detail && h('p', { text: o.detail }),
                );
            }),
        );
    }

    /**
     * Library toggles, grouped by part.
     * @param {object} v view
     */
    function librariesBody(v) {
        return h(
            'div',
            {},
            v.libraries.map(function (group) {
                return h(
                    'div.lib-group',
                    {},
                    v.libraries.length > 1 && h('h3', { text: group.part }),
                    h(
                        'div.tiles.checks',
                        {},
                        group.options.map(function (o) {
                            return checkTile(o, 'library');
                        }),
                    ),
                );
            }),
        );
    }

    /**
     * A multi-choice tile with a check mark.
     * @param {object} o view option
     * @param {string} field "library" or "extra"
     */
    function checkTile(o, field) {
        return h(
            'button.tile.check' + (o.selected ? '.selected' : ''),
            {
                role: 'checkbox',
                'aria-checked': o.selected ? 'true' : 'false',
                title: o.detail,
                onclick: function () {
                    send({ type: 'toggle', field: field, id: o.id, on: !o.selected });
                },
            },
            h('span.box', {}, icon('check')),
            o.logos && mark(o.logos, undefined, 'sm'),
            h(
                'div.check-text',
                {},
                h('strong', { text: o.label }),
                h('span.muted', { text: ' · ' + o.description }),
                state.view.beginner && o.detail && h('p', { text: o.detail }),
            ),
        );
    }

    /**
     * Extras as switch rows.
     * @param {object} v view
     */
    function extrasBody(v) {
        return h(
            'div.switches',
            {},
            v.extras.map(function (o) {
                return h(
                    'button.switch-row' + (o.selected ? '.selected' : ''),
                    {
                        role: 'switch',
                        'aria-checked': o.selected ? 'true' : 'false',
                        title: o.detail,
                        onclick: function () {
                            send({ type: 'toggle', field: 'extra', id: o.id, on: !o.selected });
                        },
                    },
                    o.logos ? mark(o.logos, o.icon, 'md') : h('span.mark.plain.md', {}, icon(o.icon)),
                    h(
                        'div.row-text',
                        {},
                        h('div', {}, h('strong', { text: o.label }), badge(o.recommended)),
                        h('span.muted', { text: v.beginner ? o.detail : o.description }),
                    ),
                    h('span.switch', {}, h('span.knob')),
                );
            }),
        );
    }

    /**
     * Folder tiles plus the Browse button.
     * @param {object} v view
     */
    function foldersBody(v) {
        const known = v.folders.some(function (f) {
            return f.selected;
        });
        const items = v.folders.map(function (f) {
            return h(
                'button.tile.folder' + (f.selected ? '.selected' : ''),
                {
                    role: 'radio',
                    'aria-checked': f.selected ? 'true' : 'false',
                    title: f.description,
                    onclick: function () {
                        send({ type: 'set', field: 'parentDir', value: f.id });
                    },
                },
                h('div.tile-top', {}, icon(f.icon), h('strong', { text: f.label })),
                h('span.muted.mono.ellipsis', { text: f.description }),
            );
        });
        // * A folder picked with Browse… gets its own selected tile.
        if (!known && v.parentDir) {
            items.push(
                h(
                    'button.tile.folder.selected',
                    { role: 'radio', 'aria-checked': 'true', title: v.parentDir },
                    h('div.tile-top', {}, icon('folder'), h('strong', { text: 'Chosen folder' })),
                    h('span.muted.mono.ellipsis', { text: v.parentDir }),
                ),
            );
        }
        items.push(
            h(
                'button.tile.folder.browse',
                {
                    onclick: function () {
                        send({ type: 'browse' });
                    },
                },
                h('div.tile-top', {}, icon('search'), h('strong', { text: 'Browse…' })),
                h('span.muted', { text: 'Any folder on your computer' }),
            ),
        );
        document.getElementById('folders').replaceChildren.apply(document.getElementById('folders'), items);
    }

    /**
     * Sticky summary with the Create button.
     * @param {object} v view
     */
    function summaryBody(v) {
        const ready = !v.nameError;
        setChildren(
            document.getElementById('summary'),
            h(
                'div.card.summary-card',
                {},
                h(
                    'div.summary-head',
                    {},
                    h(
                        'div',
                        {},
                        h('span.eyebrow', { text: 'Your project' }),
                        h('strong.project-name', { text: v.name || '…' }),
                    ),
                ),
                stack(v.stackLogos, 'md'),
                v.target && h('p.mono.muted.path', { text: v.target, title: v.target }),
                h('p.plain', { text: v.beginner ? v.plain : v.summary }),
                h(
                    'ul.facts',
                    {},
                    v.summary.split(/ · | \+ /).map(function (part) {
                        return h('li', { text: part });
                    }),
                ),
                h(
                    'button.create',
                    { disabled: !ready, onclick: create, title: ready ? 'Ctrl+Enter' : v.nameError },
                    icon('rocket'),
                    ' Create project',
                ),
                h('p.muted.small', {
                    text: ready ? 'Anything missing on your computer gets installed for you.' : v.nameError,
                }),
            ),
        );
    }

    /** Sends the current name right away and asks to create the project. */
    function create() {
        clearTimeout(state.nameTimer);
        const name = document.getElementById('name');
        if (name) {
            send({ type: 'set', field: 'name', value: name.value });
        }
        send({ type: 'create' });
    }

    // ─── Main loop ──────────────────────────────────────────────────

    /** Draws whatever screen the view asks for. */
    function render() {
        const v = state.view;
        if (v.screen === 'level') {
            state.layoutFor = undefined;
            renderLevel();
        } else if (v.screen === 'pick') {
            state.layoutFor = undefined;
            renderPick();
        } else {
            updateConfigure();
        }
    }

    window.addEventListener('message', function (event) {
        const m = event.data;
        if (m.type === 'init') {
            state.cards = m.cards;
        }
        if (m.type === 'init' || m.type === 'view') {
            const screenChanged = !state.view || state.view.screen !== m.view.screen;
            state.view = m.view;
            render();
            if (screenChanged) {
                window.scrollTo(0, 0);
            }
        }
    });

    // * Keyboard shortcuts: "/" focuses search, Ctrl/Cmd+Enter creates, Escape goes back.
    window.addEventListener('keydown', function (e) {
        const v = state.view;
        if (!v) {
            return;
        }
        const typing = e.target instanceof HTMLInputElement;
        if (e.key === '/' && !typing && v.screen === 'pick') {
            e.preventDefault();
            document.querySelector('.search').focus();
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && v.screen === 'configure') {
            create();
        } else if (e.key === 'Escape' && v.screen === 'configure' && !typing) {
            send({ type: 'home' });
        }
    });

    send({ type: 'ready' });
})();
