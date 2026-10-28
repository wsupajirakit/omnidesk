import React from 'react';

export const Simulator: React.FC = () => {
  return (
    <div className="-m-4 md:-m-6 lg:-m-8 h-[calc(100vh-64px)] overflow-y-auto">
      <div className="bg-dark-800 border border-dark-700 rounded-2xl overflow-hidden flex flex-col">
        <iframe
          title="Bot Message Editor"
          src="sim/Bot%20Message%20Editor.html"
          className="h-[calc(100vh-64px)] w-full border-0"
        />
        <div className="h-12 border-t border-dark-700 bg-dark-900" />
      </div>
    </div>
  );
};
