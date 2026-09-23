import { useState } from 'react';
import { Kbd } from './Kbd';

type AddTaskInputProps = {
  label: string;
  placeholder: string;
  onSubmit: (title: string) => void;
  disabled?: boolean;
};

/** タスクを追加する入力欄（FR-T01）。Enter で確定し、日本語入力の変換中の Enter では確定しない */
export function AddTaskInput({
  label,
  placeholder,
  onSubmit,
  disabled = false,
}: AddTaskInputProps) {
  const [title, setTitle] = useState('');
  return (
    <form
      className="add-task glass-3"
      data-add-task
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = title.trim();
        if (trimmed === '') return;
        onSubmit(trimmed);
        setTitle('');
      }}
    >
      <input
        aria-label={label}
        placeholder={placeholder}
        value={title}
        disabled={disabled}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
          // Esc で入力欄から抜け、リストのキー操作に戻る
          if (e.key === 'Escape' && !e.nativeEvent.isComposing) e.currentTarget.blur();
        }}
      />
      <Kbd>N</Kbd>
    </form>
  );
}
