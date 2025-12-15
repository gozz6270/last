declare module "react-katex" {
  import * as React from "react";

  export const InlineMath: React.ComponentType<{
    math: string;
    errorColor?: string;
    renderError?: (error: Error) => React.ReactNode;
  }>;

  export const BlockMath: React.ComponentType<{
    math: string;
    errorColor?: string;
    renderError?: (error: Error) => React.ReactNode;
  }>;
}



