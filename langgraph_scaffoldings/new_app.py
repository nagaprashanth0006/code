import streamlit as st
from rag_chat import direct_response
#from vector_store_operations import check_vs, vectorize_docs

st.title("Streamlit App")
session = st.session_state
session["vs_collections_name"] = "temporary_from_streamlit_app"
#st.info(check_vs(session["vs_collections_name"]))

uploaded_file = st.file_uploader(
    label="Select file to upload",
    type=["txt", "pdf"],
    accept_multiple_files=False,
)

if st.button("Upload file"):
    with st.spinner("Processing..", show_time=True):
        vectorized, e = True, True

    if vectorized:
        st.info("File processed.")
    else:
        st.error("Unable to process documents")
        st.error(e)

    st.info(type(uploaded_file))

prompt = st.text_input(label="Enter your prompt",
                       value="What is the name of the react project?")
                       #value="What does the chapter 3 mainly focuses on in the multi agent systems document?")
if st.button("Send", type="secondary"):
    with st.spinner("Processing", show_time=True):
        uploaded_file.seek(0)
        text = uploaded_file.read().decode("utf-8", errors="ignore")
        st.info(direct_response(prompt, text))

