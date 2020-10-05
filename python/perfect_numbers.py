
"""
https://en.wikipedia.org/wiki/Perfect_number

In number theory, a perfect number is a positive integer that is equal to the sum of its positive proper divisors, that is, divisors excluding the number itself.[1] For instance, 6 has proper divisors 1, 2 and 3, and 1 + 2 + 3 = 6, so 6 is a perfect number. The next perfect number is 28, since 1 + 2 + 4 + 7 + 14 = 28.

The first four perfect numbers are 6, 28, 496 and 8128
"""

for given_number in range(1, 1000000):
    sum_of_divisors = 0
    for i in range(1, given_number):
        if given_number%2 != 0 and i%2 == 0:
            continue
        if given_number%i == 0:
            sum_of_divisors = sum_of_divisors + i
    if sum_of_divisors == given_number:
        print(f"{given_number} PERFECT")
