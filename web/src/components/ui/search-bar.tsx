import { forwardRef, type InputHTMLAttributes } from 'react';

/**
 * SearchBar — Tailwind port of the Uiverse alexruix search bar.
 * Pink-accent focus ring, soft grey rest state, 40px tall, rounded-lg.
 *
 * Props mirror native <input>. Use `containerClassName` to size the wrapper.
 */
export type SearchBarProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  containerClassName?: string;
};

const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(function SearchBar(
  { containerClassName = '', className = '', placeholder = 'Search', ...rest },
  ref,
) {
  return (
    <div
      className={`group relative flex items-center ${containerClassName}`}
      style={{ lineHeight: '28px' }}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="pointer-events-none absolute left-4 h-4 w-4 fill-[#9e9ea7]"
      >
        <g>
          <path d="M21.53 20.47l-3.66-3.66C19.195 15.24 20 13.214 20 11c0-4.97-4.03-9-9-9s-9 4.03-9 9 4.03 9 9 9c2.215 0 4.24-.804 5.808-2.13l3.66 3.66c.147.146.34.22.53.22s.385-.073.53-.22c.295-.293.295-.767.002-1.06zM3.5 11c0-4.135 3.365-7.5 7.5-7.5s7.5 3.365 7.5 7.5-3.365 7.5-7.5 7.5-7.5-3.365-7.5-7.5z" />
        </g>
      </svg>
      <input
        ref={ref}
        type="text"
        placeholder={placeholder}
        className={`h-10 w-full rounded-lg border-2 border-transparent bg-[#f3f3f4] py-0 pl-10 pr-4 text-[14px] leading-[28px] text-[#0d0c22] outline-none transition-all duration-300 placeholder:text-[#9e9ea7] hover:border-[rgba(234,76,137,0.4)] hover:bg-white hover:shadow-[0_0_0_4px_rgba(234,76,137,0.10)] focus:border-[rgba(234,76,137,0.4)] focus:bg-white focus:shadow-[0_0_0_4px_rgba(234,76,137,0.10)] [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none [&::-webkit-search-results-button]:appearance-none [&::-webkit-search-results-decoration]:appearance-none ${className}`}
        {...rest}
      />
    </div>
  );
});

export default SearchBar;

/**
 * SearchBarButton — visual twin that acts as a clickable trigger.
 * Used in topbar to open the AppleSpotlight overlay on click / ⌘K.
 */
export function SearchBarButton({
  placeholder = 'Search',
  onClick,
  containerClassName = '',
  hint,
}: {
  placeholder?: string;
  onClick?: () => void;
  containerClassName?: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex h-10 w-full items-center rounded-lg border-2 border-transparent bg-[#f3f3f4] py-0 pl-10 pr-4 text-left text-[13px] leading-7 text-[#9e9ea7] outline-none transition-all duration-300 hover:border-[rgba(234,76,137,0.4)] hover:bg-white hover:shadow-[0_0_0_4px_rgba(234,76,137,0.10)] focus-visible:border-[rgba(234,76,137,0.4)] focus-visible:bg-white focus-visible:shadow-[0_0_0_4px_rgba(234,76,137,0.10)] ${containerClassName}`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="pointer-events-none absolute left-4 h-4 w-4 fill-[#9e9ea7]"
      >
        <g>
          <path d="M21.53 20.47l-3.66-3.66C19.195 15.24 20 13.214 20 11c0-4.97-4.03-9-9-9s-9 4.03-9 9 4.03 9 9 9c2.215 0 4.24-.804 5.808-2.13l3.66 3.66c.147.146.34.22.53.22s.385-.073.53-.22c.295-.293.295-.767.002-1.06zM3.5 11c0-4.135 3.365-7.5 7.5-7.5s7.5 3.365 7.5 7.5-3.365 7.5-7.5 7.5-7.5-3.365-7.5-7.5z" />
        </g>
      </svg>
      <span className="flex-1 truncate">{placeholder}</span>
      {hint ? (
        <span className="ml-auto rounded border border-[#e5e7eb] bg-white px-1.5 py-0.5 font-mono text-[10px] font-medium text-[#6b7280]">
          {hint}
        </span>
      ) : null}
    </button>
  );
}
