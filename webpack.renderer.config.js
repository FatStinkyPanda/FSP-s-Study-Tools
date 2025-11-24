const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const rules = require('./webpack.rules');

module.exports = {
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  target: 'electron-renderer',
  devtool: 'source-map', // Avoid eval for CSP compliance
  entry: './src/renderer/index.tsx',
  output: {
    path: path.resolve(__dirname, 'dist/renderer'),
    filename: 'main_window/index.js',
  },
  module: {
    rules: [
      ...rules,
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css'],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/renderer/index.html',
      filename: 'main_window/index.html',
    }),
  ],
};
