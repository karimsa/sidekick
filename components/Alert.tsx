import * as React from 'react';

export const Alert: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
    return (
        <div className={'p-5 border-t-4 border-red-600 bg-white rounded'}>
            <p className={'text-red-600 mb-5'}>{title}</p>
            {children}
        </div>
    );
};
