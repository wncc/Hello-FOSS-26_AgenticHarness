import React, { useMemo, useState , useEffect} from 'react';
import { Text, Box, useInput, useApp } from 'ink';
import { AgentStatus, ApprovalDecision, ChatMessage } from '../types/chat.js';
import { ToolCall } from '../types/tool.js';
import MessageList from './components/MessageList.js';
import { Agent } from '../ai/agent.js';
import { saveSession } from '../ai/session.js'
import ChatInput from './components/ChatInput.js';
import ApprovalPrompt from './components/ApprovalPrompt.js';

interface AppProps {
    agent?: Agent;
    projectRoot?: string;
}

interface PendingApproval {
    toolCall: ToolCall;
    resolve: (decision: ApprovalDecision) => void;
}

export default function App({ agent: propAgent, projectRoot }: AppProps) {
    const agent = useMemo(() => propAgent ?? new Agent(), [propAgent]);

    const [messages, setMessages] = useState<ChatMessage[]>(() => agent.getState().messages);
    const [status, setStatus] = useState<AgentStatus>('idle');
    const [activeToolName, setActiveToolName] = useState<string | undefined>();
    const [error, setError] = useState<string | undefined>();
    const [input, setInput] = useState('');
    const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
    const [streamingSnippet, setStreamingSnippet] = useState<string | undefined>();

    useEffect(() => {
    if (!projectRoot) return;
    const unsubscribe = agent.subscribe((state) => {
        saveSession(projectRoot, state.messages);
    });
    return unsubscribe;
}, [agent, projectRoot]);

    const isBusy = status === 'thinking' || status === 'executing_tool' || status === 'awaiting_approval';

    const { exit } = useApp();

    useInput((input, key) => {
        const isCtrlC = key.ctrl && input.toLowerCase() === 'c';
        const isCancelKey = key.escape || isCtrlC;

        if (!isCancelKey) return;

        if (isBusy) {
            agent.cancel();
            setPendingApproval(null);
            setStreamingSnippet(undefined);
            return;
        }

        if (isCtrlC) {
            exit();
        }
    });
    
    let statusText = 'Thinking...';
    if (status === 'awaiting_approval') {
        statusText = 'Waiting for your approval...';
    } else if (status === 'executing_tool') {
        statusText = streamingSnippet
            ? `Running ${activeToolName || 'tool'}... [${streamingSnippet}]`
            : `Running ${activeToolName || 'tool'}...`;
    }

    const handleSubmit = async (submittedText: string) => {
        setInput('');
        setError(undefined);
        setStreamingSnippet(undefined);

        const handleChunk = (chunk: string) => {
            const lines = chunk.trim().split(/\r?\n/).filter(Boolean);
            if (lines.length > 0) {
                const lastLine = lines[lines.length - 1];
                setStreamingSnippet(lastLine.length > 50 ? '...' + lastLine.slice(-47) : lastLine);
            }
        };

        for await (const event of agent.run(submittedText, handleChunk)) {
            switch (event.type) {
                case 'message':
                    setMessages((prev) => [...prev, event.message]);
                    break;
                case 'status':
                    setStatus(event.status);
                    setActiveToolName(event.activeToolName);
                    if (event.status !== 'executing_tool') {
                        setStreamingSnippet(undefined);
                    }
                    break;
                case 'approval_required':
                    setPendingApproval({
                        toolCall: event.toolCall,
                        resolve: (decision) => {
                            setPendingApproval(null);
                            event.resolve(decision);
                        },
                    });
                    break;
                case 'error':
                    setError(event.error);
                    break;
            }
        }
    };

    return (
        <Box flexDirection='column' paddingX={1}>
            <MessageList messages={messages} projectRoot={projectRoot} />

            {error && (
                <Box marginBottom={1}>
                    <Text bold color='red'>{error}</Text>
                </Box>
            )}

            {pendingApproval ? (
                <ApprovalPrompt
                    toolCall={pendingApproval.toolCall}
                    onDecision={pendingApproval.resolve}
                />
            ) : (
                <ChatInput
                    value={input}
                    onChange={setInput}
                    onSubmit={handleSubmit}
                    isDisabled={isBusy}
                    statusText={statusText}
                />
            )}
        </Box>
    );
}
