import { useEffect, useState } from 'react';
import classNames from 'classnames';
import { Dropdown, DropdownButton, DropdownContainer } from './Dropdown';

interface SelectProps {
    id: string;
    disabled?: boolean;
    className?: string;

    value: string;
    onChange(value: string): void;
    options: { value: string; label: string }[];
}

export const Select: React.FC<SelectProps> = ({ id, className, disabled, value, onChange, options, children }) => {
    useEffect(() => {
        if (!value && options.length > 0) {
            onChange(options[0].value);
        }
    }, [onChange, options, value]);

    const [isOpen, setOpen] = useState(false);

    return (
        <DropdownContainer className={'w-full'}>
            <div
                className={classNames(className, 'bg-white p-3 rounded cursor-pointer w-full', {
                    'pointer-events-none cursor-not-allowed': disabled
                })}
                onClick={() => setOpen(!isOpen)}
            >
                {value}
            </div>

            <Dropdown show={isOpen} onClose={() => setOpen(false)}>
                {options.map(option => (
                    <DropdownButton
                        key={option.value}
                        onClick={() => {
                            onChange(option.value);
                            setOpen(false);
                        }}
                    >
                        {option.label}
                    </DropdownButton>
                ))}
            </Dropdown>
        </DropdownContainer>
    );
};
