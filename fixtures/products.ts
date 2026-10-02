export type Product = { name: string; price: string; description: string };

/** The six products in the default A to Z order, with the start of each description. */
export const productsAtoZ: Product[] = [
  { name: 'Sauce Labs Backpack', price: '$29.99', description: 'carry.allTheThings()' },
  { name: 'Sauce Labs Bike Light', price: '$9.99', description: "A red light isn't" },
  { name: 'Sauce Labs Bolt T-Shirt', price: '$15.99', description: 'Get your testing superhero' },
  { name: 'Sauce Labs Fleece Jacket', price: '$49.99', description: "It's not every day" },
  { name: 'Sauce Labs Onesie', price: '$7.99', description: 'Rib snap infant onesie' },
  { name: 'Test.allTheThings() T-Shirt (Red)', price: '$15.99', description: 'This classic Sauce Labs t-shirt' },
];

export const namesAtoZ = productsAtoZ.map((p) => p.name);
export const namesZtoA = [...namesAtoZ].reverse();
export const pricesLowToHigh = ['$7.99', '$9.99', '$15.99', '$15.99', '$29.99', '$49.99'];
export const pricesHighToLow = [...pricesLowToHigh].reverse();

export const sortOptions = {
  az: 'Name (A to Z)',
  za: 'Name (Z to A)',
  lohi: 'Price (low to high)',
  hilo: 'Price (high to low)',
} as const;
