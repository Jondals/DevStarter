// Configuración de ESLint (revisa el estilo y errores comunes del código TypeScript).
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

        // Estilo del proyecto: funciones normales en vez de funciones flecha (lambdas).
        "no-restricted-syntax": ["error", {
            selector: "ArrowFunctionExpression",
            message: "Use a regular function instead of an arrow function (project style).",
        }],
    },
}];
