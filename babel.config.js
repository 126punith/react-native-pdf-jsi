module.exports = (api) => {
    if (api.env('test')) {
        return {
            presets: [
                ['@babel/preset-env', { targets: { node: 'current' } }],
                ['@babel/preset-react', { runtime: 'automatic' }],
                '@babel/preset-typescript',
            ],
        };
    }
    return {
        presets: ['module:react-native-builder-bob/babel-preset'],
    };
};
