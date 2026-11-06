// ESLint configuration: checks the style and common mistakes of the TypeScript code.
import typescriptEslint from "typescript-eslint";

export default [{
    files: ["**/*.ts"],
}, {
    plugins: {
        "@typescript-eslint": typescriptEslint.plugin,
    },

    languageOptions: {
        parser: typescriptEslint.parser,
        ecmaVersion: 2022,
        sourceType: "module",
    },

    rules: {
        "@typescript-eslint/naming-convention": ["warn", {
            selector: "import",
            format: ["camelCase", "PascalCase"],
        }],

        curly: "warn",
        eqeqeq: "warn",
        "no-throw-literal": "warn",
        semi: "warn",

        // * Project style: regular functions instead of arrow functions (lambdas).
        "no-restricted-syntax": ["error", {
            selector: "ArrowFunctionExpression",
            message: "Use a regular function instead of an arrow function (project style).",
        }],
    },
}];
