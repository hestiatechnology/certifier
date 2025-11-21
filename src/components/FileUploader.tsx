import React, { useCallback } from 'react';
import { Upload, FileType, X } from 'lucide-react';
import { clsx } from 'clsx';

interface FileUploaderProps {
  label: string;
  accept: string;
  file: File | null;
  setFile: (file: File | null) => void;
  onFileSelect?: (file: File) => void;
  color?: 'blue' | 'green';
}

export const FileUploader: React.FC<FileUploaderProps> = ({
  label,
  accept,
  file,
  setFile,
  onFileSelect,
  color = 'blue'
}) => {
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        const selected = files[0];
        setFile(selected);
        if (onFileSelect) onFileSelect(selected);
      }
    },
    [setFile, onFileSelect]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selected = e.target.files[0];
      setFile(selected);
      if (onFileSelect) onFileSelect(selected);
    }
  };

  const colorClasses = color === 'blue' 
    ? { border: 'border-blue-300 hover:border-blue-500 hover:bg-blue-50', icon: 'text-blue-400', btn: 'bg-blue-600 hover:bg-blue-700' }
    : { border: 'border-green-300 hover:border-green-500 hover:bg-green-50', icon: 'text-green-400', btn: 'bg-green-600 hover:bg-green-700' };

  return (
    <div
      className={clsx(
        "border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center transition-colors min-h-[150px] relative",
        file ? "border-gray-300 bg-gray-50" : colorClasses.border
      )}
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {file ? (
        <div className="flex items-center space-x-3">
          <FileType className="w-8 h-8 text-gray-500" />
          <div>
            <p className="font-medium text-gray-900">{file.name}</p>
            <p className="text-sm text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
          </div>
          <button
            onClick={(e) => {
                e.stopPropagation();
                setFile(null);
            }}
            className="absolute top-2 right-2 p-1 hover:bg-gray-200 rounded-full"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>
      ) : (
        <>
          <Upload className={clsx("w-10 h-10 mb-3", colorClasses.icon)} />
          <p className="text-sm text-gray-600 text-center mb-2">
            Drag & Drop your <span className="font-bold">{label}</span> here
          </p>
          <label className={clsx("cursor-pointer px-4 py-2 rounded-md text-white text-sm font-medium transition-colors", colorClasses.btn)}>
            Browse File
            <input
              type="file"
              className="hidden"
              accept={accept}
              onChange={handleChange}
            />
          </label>
        </>
      )}
    </div>
  );
};