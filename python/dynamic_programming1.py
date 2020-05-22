from datetime import datetime as dt

# Problem statement: Print the n'th element of fibonacci series.
# Constraints: Output should be given in realistic time(produce fast output).

# Input: A positive integer 'n' where 0 < n < 1000. # 1000 is max because of python's 'Recursion' limitataion.
# Output: n'th element in fibonacci series


#Fib val: 1 1 2 3 5 8 13 21 34 55 ...
#n value: 1 2 3 4 5 6 7  8  9  10 ...

now = dt.now()

## Traditional solution for getting n'th element 
## from fibonacci sequence using recursion.
def fib1(n):
    if n == 1 or n == 2:
        return 1
    else:
        return fib1(n - 1) + fib1(n - 2)

## The Dynamic programming approach with memoization:

def fib2(n, memo):
    #print("Before processing: Input -",n,"Memo -", memo)
    if n == 1 or n == 2:
        result = 1
    else:
        if memo[n] == None:
            result = fib2(n-1, memo) + fib2(n-2, memo)
        else:
            result = memo[n]
    memo[n] = result
    #print("After processing: Input -",n,"Memo -", memo)
    return result

# Input, n
n = 999         ## Python does not support recursions more than this value.

# This is called memoisation. This is basically to
# maintain state/cache between function calls.
# We will take a list of n+1 elements because we
# want to process the index from 1 just to keep it simple.
memo = [ None for _ in range(n+1) ]

# Keep in mind that when n > 40, it takes a really long time to print output.
#output = fib1(n)
output = fib2(n, memo)

print(output)
print("Time taken:", dt.now() - now)
