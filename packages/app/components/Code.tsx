export const Code: React.FC = ({ children }) => {
    return (
        <pre className={'font-mono my-5 p-5 rounded bg-gray-300 break-all overflow-auto'}>
            <code>{children}</code>
        </pre>
    );
};
