import { inspect } from 'util';

const fmtOptions = {
    depth: 100,
    colors: true
};

export function fmt(strings: TemplateStringsArray, ...values: any[]): string {
    let formattedString = strings[0];
    for (let i = 0; i < values.length; ++i) {
        formattedString += inspect(values[i], fmtOptions) + strings[i + 1];
    }
    return formattedString;
}
