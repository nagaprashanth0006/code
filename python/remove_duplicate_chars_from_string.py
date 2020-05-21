from collections import Counter
str1 = "Application Development using Python"

# Constraints:
# Capital letters will be present only at the beginning of words.
# Donot remove from start and end of any word.
# Duplicate char should match across whole string.
# Remove not only the duplicate char but also all of its occurances.
# Remove only small case letters.

# OP: "Acan Dvmt usg Pyhn"

words = str1.split()    # Collect the words from the given string.
final = ""              # Final output string will be collected here.
count = Counter(str1)   # Count the occurances for each char in given string str1.
for word in words:
	uniq = [ char for char in word[1:-2] if count[char] == 1] # Skip the start and end chars of each word and collect other non repeating chars.
	final += word[0] + "".join(uniq) + word[-1] + " "         # Join the uniq chars along with first and last chars.
print final             # The output.

#### Same thing can also be written using list comprehensions in a single line like this:

print " ".join([ word[0] + "".join([char for char in word[1:-2] if count[char] == 1]) + word[-1] for word in words])
