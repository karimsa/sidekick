import classNames from 'classnames';

interface InputProps {
    type?: 'text' | 'number';
    className?: string;
    value: string;
    onChange(value: string): void;
}

export const Input: React.FC<InputProps> = ({ type = 'text', className, value, onChange }) => {
    return (
        <input
            className={classNames(className, 'rounded p-3 bg-white border')}
            type={type}
            value={value}
            onChange={evt => onChange(evt.target.value)}
        />
    );
};
