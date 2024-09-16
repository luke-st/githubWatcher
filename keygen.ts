async function generateAndSaveKeys() {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    true,
    ['sign', 'verify']
  );

  const exportedPublicKey = await crypto.subtle.exportKey('raw', publicKey);
  const exportedPrivateKey = await crypto.subtle.exportKey('pkcs8', privateKey);

  await Bun.write('public_key.bin', exportedPublicKey);
  await Bun.write('private_key.bin', exportedPrivateKey);

  console.log('Keys generated and saved to public_key.bin and private_key.bin');
}

generateAndSaveKeys();