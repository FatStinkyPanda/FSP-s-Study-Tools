module.exports = [
  {
    test: /\.tsx?$/,
    exclude: /node_modules/,
    use: {
      loader: 'ts-loader',
      options: {
        configFile: 'tsconfig.renderer.json',
        transpileOnly: true,
      },
    },
  },
  {
    test: /\.(png|jpg|gif|svg)$/,
    type: 'asset/resource',
  },
];
